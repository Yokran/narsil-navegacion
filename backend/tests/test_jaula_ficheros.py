"""La app sirve ficheros y copia directorios. Ni una cosa ni la otra puede salirse de su sitio.

Dos agujeros comprobados contra el servidor real antes de taparlos:

1. **Lectura de cualquier fichero del operador.** La ruta comodín que sirve la interfaz
   construía la ruta con lo que llegaba por la URL. El `..` viaja codificado, el servidor lo
   descodifica antes de enrutar y el manejador lo recibe ya como `..`:

       curl --path-as-is 'http://127.0.0.1:8420/%2e%2e/%2e%2e/backend/app/config.py'  → 200, el fichero
       curl --path-as-is 'http://127.0.0.1:8420/%2e%2e/.../etc/passwd'                → 200, root:x:0:0...
       curl --path-as-is 'http://127.0.0.1:8420/%2e%2e/.../.ssh/known_hosts'          → 200, el fichero

2. **Copia de cualquier directorio del operador.** `POST /api/profiles` no validaba el nombre
   de la plantilla, y la plantilla se copia ENTERA dentro del perfil nuevo:

       {"name":"victima","template":"../../../secreto"} → el perfil nació con `robado.txt` dentro

Juntos daban lectura del equipo desde una pestaña. Por separado siguen siendo suficientes.
"""
from __future__ import annotations

import os

import pytest

# `%2e%2e` y no `..`: el cliente HTTP normaliza el `..` literal antes de mandarlo y la prueba
# no probaría nada. Codificado llega hasta el manejador.
SALTOS = [
    "/%2e%2e/%2e%2e/backend/app/config.py",
    "/%2e%2e/%2e%2e/backend/app/seguridad.py",
    "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
    "/assets/%2e%2e/%2e%2e/%2e%2e/backend/app/main.py",
    "/%2e%2e/%2e%2e/.gitignore",
]

FIRMAS_DE_FUGA = ["NARSIL_PORT", "root:x:0:0", "def run(", "base_browser/"]


@pytest.mark.parametrize("ruta", SALTOS)
def test_la_ruta_comodin_no_sirve_nada_de_fuera_de_ui_dist(cliente, ruta):
    r = cliente.get(ruta)
    # 404 (lo que hace el montaje de estáticos) o la propia interfaz (lo que hace el comodín).
    # Lo que no puede pasar, de ninguna de las dos maneras, es que salga el fichero.
    assert r.status_code in (200, 404), r.status_code
    cuerpo = r.text
    for firma in FIRMAS_DE_FUGA:
        assert firma not in cuerpo, f"{ruta} devolvió contenido de fuera de ui/dist ({firma})"
    if r.status_code == 200:
        assert "<!doctype html>" in cuerpo.lower(), "Debería caer en index.html de la interfaz"


def test_la_interfaz_se_sigue_sirviendo(cliente):
    """La jaula no puede dejar la app sin pantalla."""
    r = cliente.get("/index.html")
    assert r.status_code == 200
    assert "<div id=\"root\">" in r.text


# ── Plantillas: el otro nombre que acaba siendo una ruta ────────────────────

PLANTILLAS_HOSTILES = [
    "../../../secreto", "..", "../base_browser", "/etc", "..%2f..%2fextensions",
    "../../../../../../home",
]


@pytest.mark.parametrize("plantilla", PLANTILLAS_HOSTILES)
def test_crear_rechaza_una_plantilla_que_sale_de_templates(cliente, runtime_limpio, plantilla):
    r = cliente.post("/api/profiles", json={"name": "Victima", "template": plantilla})
    assert r.status_code == 400, r.text
    assert not (runtime_limpio.profiles / "Victima").exists(), "Se creó el perfil igualmente"


def test_crear_rechaza_el_nombre_hostil_antes_de_abrir_el_stream(cliente, runtime_limpio):
    """Un 400 limpio, no un SSE que hay que leer entero para enterarse del fallo."""
    r = cliente.post("/api/profiles", json={"name": "%2e%2e", "template": "narsil-base"})
    assert r.status_code == 400, r.text


def test_el_runtime_sigue_entero_despues(cliente, runtime_limpio):
    for plantilla in PLANTILLAS_HOSTILES:
        cliente.post("/api/profiles", json={"name": "Victima", "template": plantilla})
    assert (runtime_limpio.templates_dir / "narsil-base" / "user.js").exists()
    assert (runtime_limpio.extensions_dir / "narsil-intel@narsil.local" / "manifest.json").exists()


# ── Avatar: lo que se escribe con el nombre que diga otro ───────────────────

def _perfil(runtime_limpio, nombre="Alias_Uno"):
    destino = runtime_limpio.profiles / nombre
    destino.mkdir(parents=True, exist_ok=True)
    return destino


@pytest.mark.parametrize("nombre", ["pwn.html", "script.js", "carga.exe", "sin_extension",
                                    "../../../../evadido.png.html", "perfil.py"])
def test_el_avatar_solo_admite_imagenes(cliente, runtime_limpio, nombre):
    pdir = _perfil(runtime_limpio)
    r = cliente.post("/api/profiles/Alias_Uno/avatar",
                     files={"file": (nombre, b"<html>lo que sea</html>", "image/png")})
    assert r.status_code == 400, r.text
    assert not list(pdir.glob("avatar.*")), f"Se escribió {[p.name for p in pdir.iterdir()]}"


def test_el_avatar_valido_se_guarda(cliente, runtime_limpio):
    pdir = _perfil(runtime_limpio, "Alias_Dos")
    r = cliente.post("/api/profiles/Alias_Dos/avatar",
                     files={"file": ("retrato.PNG", b"\x89PNG\r\n\x1a\n", "image/png")})
    assert r.status_code == 200, r.text
    assert (pdir / "avatar.png").exists()


def test_el_avatar_tiene_tope_de_tamano(cliente, runtime_limpio):
    _perfil(runtime_limpio, "Alias_Tres")
    r = cliente.post("/api/profiles/Alias_Tres/avatar",
                     files={"file": ("gordo.png", b"\x00" * (4 * 1024 * 1024 + 1), "image/png")})
    assert r.status_code == 413, r.text


# ── Permisos en POSIX ───────────────────────────────────────────────────────

@pytest.mark.skipif(os.name == "nt", reason="Los permisos POSIX no aplican en Windows")
def test_los_directorios_de_datos_son_privados(cliente, runtime_limpio):
    """Los nombres de las identidades y la URL del nodo describen la operación del puesto.

    Con el umask habitual (022) nacerían listables por cualquier otra cuenta de la máquina.
    """
    cliente.get("/api/status")           # asegura que el arranque ya pasó
    for d in (runtime_limpio.profiles, runtime_limpio.settings_dir, runtime_limpio.logs):
        assert oct(d.stat().st_mode & 0o777) == "0o700", f"{d} no es privado"
