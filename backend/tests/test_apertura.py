"""La URL con la que se abre una identidad acaba en la línea de comandos de Firefox.

Firefox no distingue entre «una dirección» y «una opción»: lo que empieza por guion lo trata
como bandera. Con esa puerta abierta, un `--screenshot` escribe en disco lo que se le diga, un
`-marionette` deja conducir el navegador desde fuera y un `file:///` lee el equipo del operador
con la sesión de la identidad. Por eso la comprobación es positiva —http/https absolutas— y no
una lista de cosas prohibidas, que siempre se queda corta.
"""
from __future__ import annotations

import pytest

VECTORES = [
    "--screenshot=/tmp/robado.png",   # escribe un PNG de la página en disco
    "-marionette",                    # abre el puerto de automatización
    "file:///etc/passwd",             # lee el disco del operador
    "javascript:alert(document.cookie)",   # ejecuta en el contexto del navegador
    "-P",                             # selector de perfil: cambia de identidad
    "--new-window=file:///root",
    "",                               # campo presente pero vacío: petición mal formada
    "no-es-una-url",
    "ftp://servidor/fichero",
]


@pytest.mark.parametrize("vector", VECTORES)
def test_open_rebota_urls_hostiles(cliente, runtime_limpio, vector):
    r = cliente.post("/api/profiles/alias_valido/open", json={"url": vector})
    assert r.status_code == 400, f"{vector!r} devolvió {r.status_code}: {r.text}"


def test_open_valida_la_url_antes_de_mirar_nada_mas(cliente, runtime_limpio):
    """La URL se valida ANTES de resolver navegador o perfil.

    Importa el orden: si se validara después, un vector hostil contra un perfil inexistente
    devolvería 404 y nadie sabría que la puerta estaba abierta.
    """
    r = cliente.post("/api/profiles/perfil_que_no_existe/open", json={"url": "-marionette"})
    assert r.status_code == 400
    assert "opción" in r.json()["detail"].lower()


def test_open_acepta_una_url_legitima_y_falla_por_donde_debe(cliente, runtime_limpio):
    """Con una URL correcta la validación deja pasar y el fallo pasa a ser el real.

    Aquí el perfil no existe, así que lo esperado es 404 (o 409 si no hay navegador apto) —
    nunca un 400 de URL, que significaría que estamos rechazando direcciones buenas.
    """
    r = cliente.post("/api/profiles/perfil_que_no_existe/open",
                     json={"url": "https://narsil.interno/expediente/7"})
    assert r.status_code in (404, 409), r.text


def test_open_sin_url_sigue_valiendo(cliente, runtime_limpio):
    """Abrir sin URL es el caso normal: la identidad va a su start page.

    Se distingue de `{"url": ""}`, que sí es un 400: un campo presente y vacío es una petición
    mal formada, y darle un significado por nuestra cuenta es adivinar.
    """
    assert cliente.post("/api/profiles/perfil_que_no_existe/open", json={}).status_code in (404, 409)
    assert cliente.post("/api/profiles/perfil_que_no_existe/open").status_code in (404, 409)
    assert cliente.post("/api/profiles/perfil_que_no_existe/open",
                        json={"url": ""}).status_code == 400
