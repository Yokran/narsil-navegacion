"""Pantalla de arranque de la ventana propia.

Existe porque la app tarda en estar lista: el ejecutable se descomprime, vuelca el runtime
y levanta el servidor local antes de tener nada que enseñar, y ese rato se pasaba con una
ventana vacía. Aquí se viste esa espera con la misma pieza que abre la plataforma —escudo
grande, nombre, fondo cósmico— y se retira sola en cuanto la interfaz está cargada. No pide
ninguna tecla: una espera que ya existe se viste, no se añade otra.

El HTML es autónomo a propósito: mientras se muestra NO hay servidor, así que el escudo y la
tipografía van incrustados como datos y no hay una sola petición fuera del proceso.
"""
from __future__ import annotations

import base64
import html as _html
from pathlib import Path

from .config import REPO_ROOT, UI_DIST

# Presupuesto de la pantalla: 2,0 s en total desde el primer pintado —1,3 aquí y 0,7 en la
# interfaz (`ui/src/App.tsx`)—, decisión del Señor del 22-sep-2026. Por debajo de un segundo
# se lee como parpadeo y no como pantalla; por encima de dos, como espera impuesta. Se mantiene
# aunque el servidor ya esté listo, y no hay tope: si el arranque real tarda más, dura más.
MINIMO_VISIBLE = 1.3


def _dato(ruta: Path, tipo: str) -> str:
    return f"data:{tipo};base64,{base64.b64encode(ruta.read_bytes()).decode('ascii')}"


def _recurso(*partes: str) -> Path | None:
    """El fichero compilado (dentro del ejecutable o en `ui/dist`) o, desde el código, el de
    `ui/public`. `None` si no está en ningún sitio: la pantalla sale sin esa pieza."""
    for base in (UI_DIST, REPO_ROOT / "ui" / "public"):
        candidato = base.joinpath(*partes)
        if candidato.is_file():
            return candidato
    return None


def _css() -> str:
    """La hoja de la pantalla (`ui/public/arranque.css`, la misma que sirve la interfaz), con
    las fuentes incrustadas: aquí no hay servidor del que pedirlas."""
    hoja = _recurso("arranque.css")
    if hoja is None:
        return ""
    css = hoja.read_text(encoding="utf-8")
    for peso in ("400", "600"):
        f = _recurso("fonts", f"Archivo-{peso}-latin.woff2")
        if f is not None:
            css = css.replace(f"url('/fonts/Archivo-{peso}-latin.woff2')", f"url('{_dato(f, 'font/woff2')}')")
    return css


def _js() -> str:
    guion = _recurso("arranque.js")
    return guion.read_text(encoding="utf-8") if guion is not None else ""


def html_arranque(coletilla: str = "Navegación") -> str:
    """La pantalla completa, lista para `webview.create_window(html=...)`.

    Es el mismo marcado que lleva `ui/index.html` y la misma hoja y el mismo guion que sirve
    la interfaz: cuando la ventana navega de esta pantalla a la interfaz, lo que hay en
    pantalla no cambia ni un píxel. Solo el escudo y las fuentes van como datos, porque
    mientras se ve esto no existe el servidor."""
    escudo = _recurso("marca", "escudo.png")
    img = f'<img class="arranque__logo" alt="" src="{_dato(escudo, "image/png")}">' if escudo else ""
    return PLANTILLA.format(css=_css(), js=_js(), escudo=img, coletilla=_html.escape(coletilla))


# `{{`/`}}` porque pasa por `str.format`.
PLANTILLA = """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NARSIL — Navegación</title>
<style>{css}</style></head>
<body>
<div id="arranque" class="arranque" role="status" aria-label="Arrancando NARSIL Navegación">
  <div class="cosmos" aria-hidden="true"><canvas id="arranque-cosmos" class="cosmos__lienzo"></canvas><div class="cosmos__destello"></div></div>
  <div class="arranque__caja">
    {escudo}
    <div class="arranque__nombre">
      <span class="arranque__marca">NARSIL</span>
      <span class="arranque__coletilla">{coletilla}</span>
    </div>
    <div class="arranque__barra" role="progressbar" aria-label="Arrancando"></div>
    <div class="arranque__pie"><span>Puesto del operador</span></div>
  </div>
</div>
<script>{js}</script>
</body></html>
"""
