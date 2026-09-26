"""Ventana propia de la app.

La interfaz es la misma que sirve el servidor local; lo que cambia es dónde se pinta: en una
ventana de la propia aplicación (pywebview: WebView2 de Edge en Windows, WebKitGTK en Linux)
y no en el navegador personal del operador. Así el Módulo de navegación se comporta como lo que
es, un programa instalado, y no como una pestaña más.

El módulo tiene dos caras:

* **Servidor.** La API pregunta aquí si la app corre alojada en su ventana (`alojada()`) y le
  pide abrir el nodo en OTRA ventana de la app (`abrir()`). Si no hay ventana —modo servidor,
  desarrollo, `--sin-ventana`— devuelve `False` y el que llama cae al navegador del sistema.
* **Lanzador.** `ejecutar()` monta la ventana principal y bloquea hasta que el operador la
  cierra. Es la única función que importa pywebview, y lo hace tarde: el servidor y las
  pruebas no dependen del motor de ventanas.
"""
from __future__ import annotations

import threading
import time
import webbrowser
from pathlib import Path
from typing import Callable

TITULO = "NARSIL Navegación"
TITULO_NODO = "NARSIL S.A.R.A."
TAMANO = (1280, 840)
MINIMO = (960, 640)
FONDO = "#090D18"          # el abismo de la pantalla de arranque: es lo que el motor pinta
                           # entre un documento y el siguiente, y tiene que ser el mismo
                           # color que hay antes y después, o se ve un parpadeo

Abridor = Callable[[str, str], bool]

_abridor: Abridor | None = None
_cerrojo = threading.Lock()


def alojada() -> bool:
    """¿La app corre dentro de su propia ventana?"""
    return _abridor is not None


def registrar_abridor(fn: Abridor | None) -> None:
    global _abridor
    with _cerrojo:
        _abridor = fn


def abrir(url: str, titulo: str = TITULO_NODO) -> bool:
    """Abre `url` en una ventana nueva de la app. `False` si no hay ventana que la aloje."""
    with _cerrojo:
        fn = _abridor
    if fn is None:
        return False
    try:
        return bool(fn(url, titulo))
    except Exception:
        return False


def cerrar_todas() -> None:
    """Destruye las ventanas de la app (si las hay). Antes de salir para relanzar la versión
    nueva: con las ventanas vivas, WebView2 mantiene ficheros abiertos y el cargador de
    PyInstaller enseña un «Failed to remove temporary directory» al operador."""
    try:
        import webview
        for w in list(getattr(webview, "windows", []) or []):
            try:
                w.destroy()
            except Exception:
                pass
    except Exception:
        pass


def disponible() -> bool:
    """¿Hay motor de ventanas en este equipo?"""
    try:
        import webview  # noqa: F401
    except Exception:
        return False
    return True


def _geometria(webview) -> dict:
    """Tamaño y colocación de las ventanas de la app.

    Sin `screen`, el motor deja la ventana donde el sistema quiera: en Windows salía abajo a
    la izquierda. Con la pantalla principal, pywebview la centra en ella. Si la pantalla es
    más pequeña que el tamaño de diseño (un portátil de 1366×768), la ventana se encoge para
    caber entera; nunca nace mayor que la pantalla.
    """
    ancho, alto = TAMANO
    opciones: dict = {"min_size": MINIMO, "background_color": FONDO}
    try:
        pantallas = list(webview.screens or [])
    except Exception:
        pantallas = []
    if pantallas:
        principal = pantallas[0]
        ancho = min(ancho, max(MINIMO[0], int(principal.width * 0.92)))
        alto = min(alto, max(MINIMO[1], int(principal.height * 0.9)))
        opciones["screen"] = principal
    opciones.update({"width": ancho, "height": alto})
    return opciones


# Si el motor no llega a pintar la interfaz en este tiempo (WebView2 sin escritorio, WebKit
# roto), se abre la interfaz en el navegador del sistema y se cierra la ventana muda.
ESPERA_CARGA = 12.0


def ejecutar(url: str, icono: Path | None = None,
             al_no_cargar: Callable[[str], None] | None = None,
             html_arranque: str | None = None,
             esperar: Callable[[], bool] | None = None,
             minimo_arranque: float = 0.0,
             almacen: Path | None = None) -> bool:
    """Abre la ventana principal y bloquea hasta que se cierren todas.

    Con `html_arranque`, la ventana se abre **al instante** sobre esa pantalla (la de arranque:
    escudo, nombre, barra) mientras `esperar()` bloquea hasta que el servidor local está listo;
    entonces —y no antes de `minimo_arranque` segundos, para que no parpadee— se navega a `url`.
    Sin `html_arranque`, se abre directamente sobre `url`.

    Devuelve `True` si la ventana llegó a cargar la interfaz. Si `esperar()` dice que no hay
    servidor, se destruye la ventana y devuelve `False` sin abrir nada más: no hay a qué caer.
    Si el servidor está pero la interfaz no carga en `ESPERA_CARGA`, llama a `al_no_cargar(url)`
    (por defecto, el navegador del sistema), destruye la ventana y devuelve `False`: mejor una
    pestaña que una ventana vacía.
    """
    import webview

    # Los enlaces externos (`target=_blank`) salen al navegador del sistema: el embudo
    # comercial y la documentación no se leen dentro de la app.
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.settings["ALLOW_DOWNLOADS"] = True
    # La app nunca carga `file://`: cerrado, por si una página lo intenta desde la ventana.
    webview.settings["ALLOW_FILE_URLS"] = False

    comun = _geometria(webview)

    def _nueva(destino: str, titulo: str) -> bool:
        webview.create_window(titulo, destino, **comun)
        return True

    registrar_abridor(_nueva)
    if html_arranque:
        principal = webview.create_window(TITULO, html=html_arranque, **comun)
    else:
        principal = webview.create_window(TITULO, url, **comun)

    cargada = threading.Event()

    def _al_cargar(*_a) -> None:
        # La pantalla de arranque también dispara `loaded`: solo cuenta la interfaz.
        try:
            actual = principal.get_current_url() or ""
        except Exception:
            actual = ""
        if not html_arranque or actual.startswith(url):
            cargada.set()

    principal.events.loaded += _al_cargar

    def _conducir() -> None:
        if html_arranque:
            inicio = time.monotonic()
            listo = esperar() if esperar else True
            if not listo:
                registrar_abridor(None)
                try:
                    principal.destroy()
                except Exception:
                    pass
                return
            resto = minimo_arranque - (time.monotonic() - inicio)
            if resto > 0:
                time.sleep(resto)
            principal.load_url(url)
        if cargada.wait(ESPERA_CARGA):
            return
        registrar_abridor(None)
        try:
            (al_no_cargar or webbrowser.open)(url)
        finally:
            try:
                principal.destroy()
            except Exception:
                pass

    try:
        # `private_mode=False`: el idioma elegido y demás preferencias de la interfaz viven en
        # localStorage y tienen que sobrevivir al cierre. El icono lo usan GTK/Qt; en Windows
        # la ventana hereda el del ejecutable. `func` corre en un hilo aparte cuando el motor
        # ya está en marcha: conduce el arranque y vigila la carga.
        # `storage_path`: sin él, el motor deja caché y cookies (la sesión del nodo, en texto
        # plano) en `~/.cache/<ejecutable>` con permisos por defecto, fuera del perímetro 0700
        # de `data/`. Dentro de `data/` se llevan con la instalación y se protegen igual.
        opciones = {"private_mode": False}
        if almacen is not None:
            opciones["storage_path"] = str(almacen)
        if icono is not None and icono.exists():
            opciones["icon"] = str(icono)
        webview.start(_conducir, **opciones)
    finally:
        registrar_abridor(None)
    return cargada.is_set()
