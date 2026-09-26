"""El puerto local no es un puerto privado.

Cada identidad abre por oficio páginas hostiles. Una de esas páginas puede hablar con
`http://127.0.0.1:8420` —no necesita permiso de nadie para intentarlo— y, si además consigue
que su propio dominio resuelva a 127.0.0.1 (DNS rebinding), el navegador la considera MISMO
ORIGEN y le deja leer las respuestas: el inventario de identidades, sus metadatos con las
credenciales veladas y la URL del nodo.

Antes del guardia esto funcionaba, comprobado con curl contra el servidor real:

    curl -X PUT http://127.0.0.1:8420/api/node -H 'Origin: https://evil.example' \
         -H 'Content-Type: application/json' -d '{"url":"http://nodo-falso.evil:7420"}'
    → 200 {"ok":true,"url":"http://nodo-falso.evil:7420"}

Es decir: una web hostil cambiaba el destino del botón «Abrir NARSIL» y el operador se
autenticaba en el nodo del atacante. Estas pruebas cierran esa puerta y la dejan cerrada.
"""
from __future__ import annotations

import pytest

from app.seguridad import CABECERAS_SEGURIDAD, host_es_local, origen_es_local

ORIGENES_HOSTILES = [
    "https://evil.example",
    "http://evil.example:8420",
    "http://127.0.0.1.evil.example",     # el clásico: parece loopback y no lo es
    "http://localhost.evil.example",
    "null",                               # iframe con sandbox
]


# ── DNS rebinding: la cabecera Host ─────────────────────────────────────────

@pytest.mark.parametrize("host", ["evil.example", "narsil-nav.local", "192.0.2.16:8420",
                                  "127.0.0.1.evil.example:8420"])
def test_se_rechaza_un_host_que_no_sea_este_equipo(cliente, host):
    r = cliente.get("/api/status", headers={"Host": host})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("host", ["127.0.0.1:8420", "127.0.0.1", "localhost:8420", "[::1]:8420"])
def test_el_host_local_pasa(cliente, host):
    assert cliente.get("/api/status", headers={"Host": host}).status_code == 200


def test_el_rebinding_no_llega_ni_a_los_metadatos(cliente, runtime_limpio):
    """Lo que se llevaría un rebinding: categoría, notas y credenciales de cada identidad."""
    r = cliente.get("/api/profiles/Alias_Uno/meta", headers={"Host": "evil.example"})
    assert r.status_code == 403


# ── CSRF: el origen de lo que muta ──────────────────────────────────────────

@pytest.mark.parametrize("origen", ORIGENES_HOSTILES)
def test_un_origen_hostil_no_cambia_el_nodo(cliente, runtime_limpio, origen):
    antes = cliente.get("/api/node").json()["url"]
    r = cliente.put("/api/node", json={"url": "http://nodo-falso.evil:7420"},
                    headers={"Origin": origen})
    assert r.status_code == 403, r.text
    assert cliente.get("/api/node").json()["url"] == antes, "El nodo cambió con un origen hostil"


@pytest.mark.parametrize("origen", ORIGENES_HOSTILES)
def test_un_origen_hostil_no_abre_una_identidad(cliente, runtime_limpio, origen):
    """`fetch(..., {mode:'no-cors'})` contra `/open` no necesita preflight: es petición simple."""
    r = cliente.post("/api/profiles/Alias_Uno/open", headers={"Origin": origen})
    assert r.status_code == 403, r.text


def test_un_origen_hostil_no_abre_el_nodo_ni_instala_nada(cliente, runtime_limpio):
    for ruta in ("/api/node/open", "/api/profiles/browser/install"):
        r = cliente.post(ruta, headers={"Origin": "https://evil.example"})
        assert r.status_code == 403, f"{ruta}: {r.status_code}"


def test_un_origen_hostil_no_borra_ni_renombra(cliente, runtime_limpio):
    hostil = {"Origin": "https://evil.example"}
    assert cliente.delete("/api/profiles/Alias_Uno", headers=hostil).status_code == 403
    assert cliente.patch("/api/profiles/Alias_Uno", json={"name": "otro"},
                         headers=hostil).status_code == 403
    assert cliente.delete("/api/profiles/templates/una", headers=hostil).status_code == 403
    assert cliente.post("/api/profiles/Alias_Uno/meta", json={"category": "OSINT"},
                        headers=hostil).status_code == 403


def test_el_referer_hostil_tambien_se_rechaza(cliente, runtime_limpio):
    """Sin `Origin` pero con `Referer`: el navegador manda uno u otro, se miran los dos."""
    r = cliente.put("/api/node", json={"url": "http://otro.evil:7420"},
                    headers={"Referer": "https://evil.example/pagina"})
    assert r.status_code == 403


@pytest.mark.parametrize("origen", ["http://127.0.0.1:8420", "http://localhost:8420",
                                    "http://127.0.0.1:5273"])   # 5273 = dev server de Vite
def test_la_interfaz_propia_sigue_funcionando(cliente, runtime_limpio, origen):
    r = cliente.put("/api/node", json={"url": "https://nodo.interno:7420"},
                    headers={"Origin": origen})
    assert r.status_code == 200, r.text
    assert cliente.get("/api/node").json()["url"] == "https://nodo.interno:7420"


def test_sin_origen_se_deja_pasar(cliente, runtime_limpio):
    """curl, un script del operador o estas mismas pruebas: no hay navegador, no hay CSRF."""
    assert cliente.put("/api/node", json={"url": ""}).status_code == 200


# ── Sec-Fetch-Site: lo que el navegador cuenta y el atacante no puede falsear ──

@pytest.mark.parametrize("ruta", ["/api/status", "/api/profiles", "/profile-start/Alias_Uno"])
def test_sec_fetch_site_cross_site_se_rechaza(cliente, runtime_limpio, ruta):
    r = cliente.get(ruta, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("sitio", ["same-origin", "same-site", "none"])
def test_sec_fetch_site_propio_pasa(cliente, sitio):
    assert cliente.get("/api/status", headers={"Sec-Fetch-Site": sitio}).status_code == 200


def test_la_nueva_pestana_de_la_identidad_sigue_abriendo(cliente, runtime_limpio):
    """La nueva pestaña es una página `moz-extension://` que redirige a la start page.

    Para el navegador esa navegación es `cross-site`. Si el guardia la bloqueara, cada
    identidad abriría pestañas nuevas con un error en vez de su portada — y el operador
    perdería el único cartel que le dice con quién está operando.
    """
    r = cliente.get("/profile-start/Alias_Uno",
                    headers={"Sec-Fetch-Site": "cross-site",
                             "Sec-Fetch-Mode": "navigate",
                             "Sec-Fetch-Dest": "document"})
    assert r.status_code == 200, r.text
    assert "Alias Uno" in r.text


def test_la_excepcion_de_navegacion_no_deja_pasar_lo_que_muta(cliente, runtime_limpio):
    """Un formulario hostil también navega: si el método muta, no vale la excepción."""
    r = cliente.post("/api/profiles/Alias_Uno/open",
                     headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"})
    assert r.status_code == 403


# ── Cabeceras de protección ─────────────────────────────────────────────────

@pytest.mark.parametrize("ruta", ["/api/status", "/profile-start/Alias_Uno", "/"])
def test_todas_las_respuestas_llevan_las_cabeceras(cliente, ruta):
    r = cliente.get(ruta)
    for clave, valor in CABECERAS_SEGURIDAD.items():
        assert r.headers.get(clave) == valor, f"{ruta} sin {clave}"


def test_la_csp_no_deja_salir_del_equipo(cliente):
    csp = cliente.get("/api/status").headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp       # ni una identidad enmarca la app
    assert "connect-src 'self'" in csp


def test_la_api_no_se_cachea(cliente):
    """Credenciales veladas y nombres de identidad no se quedan en el disco del navegador."""
    assert cliente.get("/api/status").headers.get("cache-control") == "no-store"


# ── Las piezas sueltas ──────────────────────────────────────────────────────

@pytest.mark.parametrize("valor,esperado", [
    ("127.0.0.1:8420", True), ("localhost", True), ("[::1]:8420", True),
    ("evil.example", False), ("127.0.0.1.evil.example", False), ("", False), (None, False),
])
def test_host_es_local(valor, esperado):
    assert host_es_local(valor) is esperado


@pytest.mark.parametrize("valor,esperado", [
    ("http://127.0.0.1:8420", True), ("http://localhost:5273", True), ("http://[::1]:8420", True),
    ("https://evil.example", False), ("http://127.0.0.1.evil.example", False),
    ("file:///etc/passwd", False), ("null", False), ("", False), (None, False),
])
def test_origen_es_local(valor, esperado):
    assert origen_es_local(valor) is esperado


def test_una_navegacion_de_otro_sitio_no_llega_a_la_api(cliente):
    """Un `<iframe src="/api/…">` desde una web hostil abierta en una identidad: mode=navigate,
    site=cross-site. La start page sí puede venir así; la API, no."""
    cab = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe"}
    assert cliente.get("/api/node/probe", headers=cab).status_code == 403
    assert cliente.get("/api/profiles", headers=cab).status_code == 403
    assert cliente.get("/profile-start/Prueba", headers=cab).status_code == 200
