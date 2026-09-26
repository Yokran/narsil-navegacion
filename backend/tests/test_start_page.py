"""La start page del perfil no habla con nadie de fuera.

La del preview cargaba tipografías de Google: cada identidad, al abrirse, le decía a Google
desde qué IP y a qué hora empezaba a trabajar. Cuarenta identidades con VPN distintas y un
único testigo común. Esta prueba existe para que eso no vuelva por descuido.
"""
from __future__ import annotations

import re

import pytest

# Cualquier esquema absoluto en el HTML es sospechoso salvo el propio 127.0.0.1.
EXTERNO = re.compile(r'(?:https?:)?//(?!127\.0\.0\.1|localhost)[A-Za-z0-9.-]+', re.I)

DOMINIOS_PROHIBIDOS = [
    "fonts.googleapis.com", "fonts.gstatic.com", "google.com", "gstatic.com",
    "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "mozilla.org",
]


@pytest.fixture()
def pagina(cliente) -> str:
    r = cliente.get("/profile-start/Alias_Uno")
    assert r.status_code == 200
    return r.text


def test_no_hay_ni_un_dominio_externo(pagina):
    encontrados = EXTERNO.findall(pagina)
    assert not encontrados, f"La start page pide recursos fuera del equipo: {encontrados}"


@pytest.mark.parametrize("dominio", DOMINIOS_PROHIBIDOS)
def test_dominios_concretos_prohibidos(pagina, dominio):
    assert dominio not in pagina


def test_las_fuentes_son_locales(pagina):
    """Se declaran con rutas relativas, que sirve la propia app en 127.0.0.1."""
    for src in re.findall(r'src:\s*url\("([^"]+)"\)', pagina):
        assert src.startswith("/fonts/"), f"Fuente no local: {src}"


def test_el_escudo_es_el_de_marca_y_lo_sirve_la_app(pagina):
    """El escudo es el PNG de marca, pedido a la propia app: mismo origen,
    ninguna petición fuera del equipo."""
    assert 'src="/marca/escudo.png"' in pagina
    assert "<svg" not in pagina
    assert "http://" not in pagina.split("<body>")[1] and "https://" not in pagina.split("<body>")[1]


def test_lleva_la_estetica_de_la_plataforma(pagina):
    """Navy de lienzo y bronce de filete — la misma marca que el nodo, no otra."""
    assert "#141B2E" in pagina      # lienzo
    assert "#E4DED9" in pagina      # texto
    assert "#9F6A57" in pagina      # bronce, como filete
    for teal in ("#00d1b2", "#00e5ff", "#020810"):
        assert teal not in pagina, f"Queda paleta del preview: {teal}"


def test_dice_de_quien_es_la_identidad(pagina):
    """Sin esto, la página es decorativa. Con esto, evita operar con quien no toca."""
    assert "Alias Uno" in pagina


def test_el_nombre_se_escapa(cliente):
    """El nombre llega por URL y se pinta: se escapa, o es un XSS servido en casa."""
    # Sin barras: un %2F rompe el enrutado antes de llegar aquí y la prueba no probaría nada.
    r = cliente.get("/profile-start/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E")
    assert r.status_code == 200
    assert "<img src=x onerror=alert(1)>" not in r.text
    assert "&lt;img" in r.text
