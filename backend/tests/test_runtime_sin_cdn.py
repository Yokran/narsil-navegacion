"""Nada de lo que se instala dentro de una identidad pide recursos a un tercero.

Esta prueba mira el runtime REAL que se distribuye —la extensión Collector y la plantilla
base—, no un doble. Es la única forma de que el fallo que la motivó no vuelva.

El fallo: `content.js` de la Collector traía

    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');

y ese CSS se inyecta en **cada web visitada**. Cada identidad, en cada página, pedía una
tipografía a Google desde su propia IP y su propia VPN. Cuarenta identidades construidas para
no parecerse entre sí, y todas saludando al mismo tercero. La app existe para que eso no pase, y
lo traía dentro.
"""
from __future__ import annotations

import re

import pytest

from app.config import APP_ROOT

RUNTIME = APP_ROOT / "data" / "runtime"
EXTENSIONES = RUNTIME / "extensions"
PLANTILLAS = RUNTIME / "templates"

# Terceros que no pintan nada dentro de una identidad. Los dominios de las redes que la
# Collector raspa (instagram, x, tiktok…) sí son legítimos: son el objeto del trabajo.
TERCEROS = [
    "fonts.googleapis.com", "fonts.gstatic.com", "ajax.googleapis.com",
    "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "code.jquery.com",
    "google-analytics.com", "googletagmanager.com", "bootstrapcdn.com",
]

EXTENSIONES_TEXTO = (".js", ".html", ".css", ".json", ".svg")


def _ficheros(raiz):
    return [f for f in raiz.rglob("*") if f.is_file() and f.suffix in EXTENSIONES_TEXTO]


@pytest.mark.parametrize("dominio", TERCEROS)
def test_la_extension_collector_no_llama_a_terceros(dominio):
    culpables = [f for f in _ficheros(EXTENSIONES)
                 if dominio in f.read_text(encoding="utf-8", errors="ignore")]
    assert not culpables, f"{dominio} aparece en: {[str(c) for c in culpables]}"


@pytest.mark.parametrize("dominio", TERCEROS)
def test_la_plantilla_base_no_llama_a_terceros(dominio):
    culpables = [f for f in _ficheros(PLANTILLAS)
                 if dominio in f.read_text(encoding="utf-8", errors="ignore")]
    assert not culpables, f"{dominio} aparece en: {[str(c) for c in culpables]}"


def test_ningun_at_import_a_una_url_absoluta():
    """`@import url(...)` con esquema es, por definición, una petición a otro sitio."""
    patron = re.compile(r"@import\s+url\(\s*['\"]?https?://", re.I)
    culpables = []
    for raiz in (EXTENSIONES, PLANTILLAS):
        for f in _ficheros(raiz):
            if patron.search(f.read_text(encoding="utf-8", errors="ignore")):
                culpables.append(str(f))
    assert not culpables, f"@import externo en: {culpables}"


def test_el_runtime_lleva_la_paleta_de_la_plataforma():
    """La del preview no vuelve por la puerta de atrás del runtime."""
    prohibidos = ["#00d1b2", "#00e5ff", "#020810", "Share Tech Mono", "Rajdhani"]
    culpables = []
    for raiz in (EXTENSIONES, PLANTILLAS):
        for f in _ficheros(raiz):
            texto = f.read_text(encoding="utf-8", errors="ignore")
            for p in prohibidos:
                if p in texto:
                    culpables.append(f"{f.name}: {p}")
    assert not culpables, f"Paleta o tipografía del preview en el runtime: {culpables}"


def test_la_collector_sigue_siendo_la_collector():
    """Retematizar no puede haber roto el manifiesto: el id y los permisos son su contrato."""
    import json
    manifest = json.loads(
        (EXTENSIONES / "narsil-intel@narsil.local" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["browser_specific_settings"]["gecko"]["id"] == "narsil-intel@narsil.local"
    assert manifest["name"] == "NARSIL Intelligence Collector"
    assert "<all_urls>" in manifest["permissions"]
    assert manifest["background"]["scripts"] == ["background.js"]
