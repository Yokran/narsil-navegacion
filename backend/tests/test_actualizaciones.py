"""El actualizador: versiones, GitHub falso, suma obligatoria y guion de intercambio."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest

from app import actualizaciones as ac


# ── Versiones ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("vieja,nueva", [
    ("1.0-rc2", "1.0"), ("1.0-rc2", "1.0-rc3"), ("1.0", "1.0.1"), ("1.0", "1.1"), ("0.9", "v1.0"),
])
def test_una_version_mas_nueva_se_reconoce(vieja, nueva):
    assert ac.hay_nueva(vieja, nueva)


@pytest.mark.parametrize("vieja,nueva", [("1.0", "1.0"), ("1.0", "1.0-rc9"), ("1.1", "1.0"), ("1.0-rc3", "1.0-rc2")])
def test_una_version_igual_o_mas_vieja_no(vieja, nueva):
    assert not ac.hay_nueva(vieja, nueva)


def test_una_etiqueta_rara_no_revienta_en_silencio():
    with pytest.raises(ac.ActualizacionError):
        ac.clave_version("ultima")


def test_el_artefacto_depende_de_la_plataforma():
    assert ac.nombre_artefacto("windows-x86_64").endswith(".exe")
    assert ac.nombre_artefacto("linux-aarch64") == "narsil-navegacion-linux-aarch64"
    with pytest.raises(ac.ActualizacionError):
        ac.nombre_artefacto("macos-arm64")


# ── GitHub falso ────────────────────────────────────────────────────────────
class _Respuesta(io.BytesIO):
    def __init__(self, datos: bytes):
        super().__init__(datos)
        self.headers = {"Content-Length": str(len(datos))}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _github(release: dict, ficheros: dict[str, bytes]):
    def abrir(url, timeout=None):
        if "releases/latest" in url:
            return _Respuesta(json.dumps(release).encode())
        for nombre, datos in ficheros.items():
            if url.endswith(nombre):
                return _Respuesta(datos)
        raise OSError(f"sin ruta para {url}")
    return abrir


def _release(version: str, nombres: list[str]):
    return {"tag_name": f"v{version}", "html_url": "https://github.com/x/y/releases/tag/v" + version,
            "body": "Notas", "assets": [{"name": n, "browser_download_url": f"https://descargas/{n}", "size": 10}
                                        for n in nombres]}


def test_comprobar_dice_si_hay_nueva_y_si_se_puede_aplicar():
    abrir = _github(_release("1.0", ["NARSIL Navegacion-windows-x86_64.exe", "SHA256SUMS"]), {})
    info = ac.comprobar("1.0-rc2", "windows-x86_64", abrir)
    assert info["disponible"] and info["aplicable"] and info["publicada"] == "1.0"
    assert info["url_artefacto"].endswith("windows-x86_64.exe")


def test_sin_sumas_publicadas_no_es_aplicable():
    abrir = _github(_release("1.0", ["NARSIL Navegacion-windows-x86_64.exe"]), {})
    info = ac.comprobar("1.0-rc2", "windows-x86_64", abrir)
    assert info["disponible"] and not info["aplicable"]


def test_si_github_no_contesta_el_error_se_explica():
    def abrir(url, timeout=None):
        raise OSError("sin red")
    with pytest.raises(ac.ActualizacionError, match="GitHub"):
        ac.comprobar("1.0", "linux-x86_64", abrir)


# ── Descarga con suma obligatoria ───────────────────────────────────────────
def test_la_descarga_con_suma_correcta_se_guarda(tmp_path):
    datos = b"ejecutable nuevo"
    sha = hashlib.sha256(datos).hexdigest()
    abrir = _github({}, {"app.exe": datos})
    llamadas = []
    destino = ac.descargar("https://d/app.exe", tmp_path / "app.exe.nuevo", sha,
                           progreso=lambda l, t: llamadas.append((l, t)), abrir=abrir)
    assert destino.read_bytes() == datos and llamadas[-1] == (len(datos), len(datos))


def test_la_descarga_con_suma_incorrecta_se_borra_y_no_se_instala(tmp_path):
    abrir = _github({}, {"app.exe": b"manipulado"})
    with pytest.raises(ac.ActualizacionError, match="SHA-256"):
        ac.descargar("https://d/app.exe", tmp_path / "app.exe.nuevo", "00" * 32, abrir=abrir)
    assert not (tmp_path / "app.exe.nuevo").exists()


def test_leer_suma_acepta_el_formato_de_sha256sum():
    sumas = "abc123  SHA256SUMS\n" + "f" * 64 + " *NARSIL Navegacion-windows-x86_64.exe\n"
    assert ac.leer_suma(sumas, "NARSIL Navegacion-windows-x86_64.exe") == "f" * 64
    with pytest.raises(ac.ActualizacionError):
        ac.leer_suma(sumas, "otro")


# ── El intercambio, desde el propio proceso ─────────────────────────────────
def test_intercambiar_aparta_el_viejo_y_coloca_el_nuevo(tmp_path):
    exe = tmp_path / "app.exe"; exe.write_bytes(b"viejo")
    nuevo = tmp_path / "data" / "actualizaciones" / "app.exe.nuevo"; nuevo.parent.mkdir(parents=True); nuevo.write_bytes(b"nuevo")
    viejo = ac.intercambiar(exe, nuevo)
    assert exe.read_bytes() == b"nuevo" and viejo.read_bytes() == b"viejo" and not nuevo.exists()


def test_si_no_se_puede_colocar_el_nuevo_el_viejo_vuelve(tmp_path):
    exe = tmp_path / "app.exe"; exe.write_bytes(b"viejo")
    with pytest.raises(ac.ActualizacionError, match="se conserva"):
        ac.intercambiar(exe, tmp_path / "no-existe.nuevo")
    assert exe.read_bytes() == b"viejo" and not exe.with_name("app.exe.old").exists()


def test_el_viejo_se_borra_en_el_siguiente_arranque(tmp_path):
    exe = tmp_path / "app.exe"; exe.write_bytes(b"nuevo")
    exe.with_name("app.exe.old").write_bytes(b"viejo")
    assert ac.limpiar_viejo(exe) is True and not exe.with_name("app.exe.old").exists()
    assert ac.limpiar_viejo(exe) is False


def test_la_app_no_lanza_ningun_proceso_al_actualizar():
    """Los tres fallos del 22-sep salieron del relanzamiento automático (Defender, carrera de
    puerto, herencia del cargador). Ahora el intercambio no lanza nada: avisa y el operador
    vuelve a abrirla."""
    import inspect
    fuente = inspect.getsource(ac)
    assert "import subprocess" not in fuente and "startfile(" not in fuente and "Popen(" not in fuente


def test_cerrar_por_api_suelta_todo_y_sale(cliente, monkeypatch):
    from app import ciclo
    from app.api import actualizaciones as api
    orden: list[str] = []
    monkeypatch.setattr(ciclo, "antes_de_cerrar", lambda: orden.append("soltar"))
    monkeypatch.setattr(api.os, "_exit", lambda c: orden.append("salir"))
    monkeypatch.setattr(api, "ESPERA_CIERRE", 0.05)
    assert cliente.post("/api/actualizaciones/cerrar").json() == {"ok": True}
    import time; time.sleep(0.3)
    assert orden == ["soltar", "salir"]


# ── La API ──────────────────────────────────────────────────────────────────
def test_desde_el_codigo_no_se_aplica(cliente):
    assert cliente.post("/api/actualizaciones/aplicar").status_code == 400


def test_comprobar_por_api_devuelve_lo_de_github(cliente, monkeypatch):
    monkeypatch.setattr(ac, "_abrir", _github(_release("9.9", ["narsil-navegacion-linux-aarch64", "narsil-navegacion-linux-x86_64", "NARSIL Navegacion-windows-x86_64.exe", "SHA256SUMS"]), {}))
    r = cliente.get("/api/actualizaciones")
    assert r.status_code == 200 and r.json()["disponible"] is True and r.json()["publicada"] == "9.9"


def test_si_github_falla_la_api_lo_dice_con_502(cliente, monkeypatch):
    def roto(url, timeout=None):
        raise OSError("sin red")
    monkeypatch.setattr(ac, "_abrir", roto)
    r = cliente.get("/api/actualizaciones")
    assert r.status_code == 502 and "GitHub" in r.json()["detail"]


def test_github_publica_los_adjuntos_con_puntos_en_vez_de_espacios():
    """Visto el 22-sep en la primera release: `NARSIL Navegacion-…exe` aparece como
    `NARSIL.Navegacion-…exe` en la API, y SHA256SUMS lo lista con el espacio. Con la
    comparación literal el actualizador decía «no trae ejecutable» y nadie podría actualizar."""
    abrir = _github(_release("1.0", ["NARSIL.Navegacion-windows-x86_64.exe", "SHA256SUMS"]), {})
    info = ac.comprobar("1.0-rc3", "windows-x86_64", abrir)
    assert info["aplicable"] and info["url_artefacto"].endswith("NARSIL.Navegacion-windows-x86_64.exe")
    assert info["artefacto"] == "NARSIL Navegacion-windows-x86_64.exe"
    sumas = "f" * 64 + "  NARSIL Navegacion-windows-x86_64.exe\n"
    assert ac.leer_suma(sumas, "NARSIL Navegacion-windows-x86_64.exe") == "f" * 64
    assert ac.leer_suma(sumas, "NARSIL.Navegacion-windows-x86_64.exe") == "f" * 64
