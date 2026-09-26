"""Ajuste del nodo NARSIL: guardar, leer y validar.

Lo que aquí se guarda termina en `webbrowser.open` sobre el equipo del operador. Una URL sin
validar en ese sitio no es un campo mal puesto: es un botón que abre lo que le digan.
"""
from __future__ import annotations

import json

import pytest

from app import ajustes
from app.context import runtime_paths

BUENAS = [
    ("https://nodo.interno:7420", "https://nodo.interno:7420"),
    ("http://127.0.0.1:7420", "http://127.0.0.1:7420"),
    ("https://narsil.example.org/", "https://narsil.example.org"),   # se normaliza la barra
    ("  https://narsil.example.org  ", "https://narsil.example.org"),
]

MALAS = [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://servidor/x",
    "nodo.interno:7420",        # sin esquema no es absoluta
    "https://",                 # sin servidor
    "//nodo.interno",
    "-marionette",
]


@pytest.mark.parametrize("entrada,esperada", BUENAS)
def test_urls_validas(entrada, esperada):
    assert ajustes.validar_url_nodo(entrada) == esperada


@pytest.mark.parametrize("entrada", MALAS)
def test_urls_invalidas(entrada):
    with pytest.raises(ajustes.UrlInvalida):
        ajustes.validar_url_nodo(entrada)


def test_vacio_es_modo_autonomo():
    """Sin nodo, la app funciona igual: las identidades no dependen de la plataforma."""
    assert ajustes.validar_url_nodo("") == ""
    assert ajustes.validar_url_nodo("   ") == ""


def test_guardar_y_releer_por_la_api(cliente):
    r = cliente.put("/api/node", json={"url": "https://nodo.interno:7420/"})
    assert r.status_code == 200, r.text
    assert r.json()["url"] == "https://nodo.interno:7420"

    assert cliente.get("/api/node").json()["url"] == "https://nodo.interno:7420"
    # Y aparece también en el estado general, que es lo que lee la cabecera.
    assert cliente.get("/api/status").json()["node"] == "https://nodo.interno:7420"


def test_se_persiste_en_disco(cliente):
    cliente.put("/api/node", json={"url": "https://persistente.interno"})
    fichero = runtime_paths.settings_dir / "app.json"
    assert fichero.exists(), "El ajuste del nodo tiene que sobrevivir al cierre de la app"
    assert json.loads(fichero.read_text(encoding="utf-8"))["node_url"] == "https://persistente.interno"


@pytest.mark.parametrize("mala", MALAS)
def test_la_api_rechaza_urls_hostiles(cliente, mala):
    r = cliente.put("/api/node", json={"url": mala})
    assert r.status_code == 400, f"{mala!r} devolvió {r.status_code}"


def test_una_url_hostil_no_pisa_la_buena(cliente):
    cliente.put("/api/node", json={"url": "https://bueno.interno"})
    cliente.put("/api/node", json={"url": "file:///etc/passwd"})
    assert cliente.get("/api/node").json()["url"] == "https://bueno.interno"


def test_abrir_sin_nodo_configurado_no_abre_nada(cliente):
    cliente.put("/api/node", json={"url": ""})
    r = cliente.post("/api/node/open")
    assert r.status_code == 400


def test_sonda_sin_nodo(cliente):
    cliente.put("/api/node", json={"url": ""})
    datos = cliente.get("/api/node/probe").json()
    assert datos == {"configured": False, "reachable": False, "detail": "No hay ninguna S.A.R.A. configurada."}


def test_sonda_con_nodo_caido(cliente):
    """Puerto cerrado en loopback: responde rápido y dice que no, sin colgar la interfaz."""
    cliente.put("/api/node", json={"url": "http://127.0.0.1:9"})
    datos = cliente.get("/api/node/probe").json()
    assert datos["configured"] is True
    assert datos["reachable"] is False
    assert "no responde" in datos["detail"].lower()


def test_abrir_usa_el_navegador_del_sistema(cliente, monkeypatch):
    """El nodo se abre en el navegador PERSONAL, no dentro de una identidad operativa."""
    abiertas = []
    monkeypatch.setattr("app.api.system.webbrowser.open",
                        lambda url: abiertas.append(url) or True)
    cliente.put("/api/node", json={"url": "https://nodo.interno:7420"})
    r = cliente.post("/api/node/open")
    assert r.status_code == 200
    assert abiertas == ["https://nodo.interno:7420"]
