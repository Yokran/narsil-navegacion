"""Arranque de la app como programa de escritorio.

Un solo proceso: el servidor local en un hilo y la ventana en el hilo principal (los motores
de ventanas exigen el principal). Cerrar la última ventana para el servidor y termina el
programa. Si ya hay una instancia sirviendo en el puerto, no se levanta otra: se abre una
ventana sobre la que está.

Opciones:
  --sin-ventana   solo el servidor local (para comprobaciones por consola o SSH, donde no
                  hay escritorio); se para con Ctrl+C.
"""
from __future__ import annotations

import json
import logging
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler

from . import arranque, ciclo, ventana
from .config import EMPAQUETADO, ICONO, NARSIL_PORT, NAV_HOST
from .context import runtime_paths
from .core.profile_manager import asegurar_directorio_privado, asegurar_fichero_privado

URL_LOCAL = f"http://{NAV_HOST}:{NARSIL_PORT}"
ESPERA_ARRANQUE = 25.0


def _preparar_registro() -> None:
    """Todo al fichero de registro. Empaquetado sin consola, `sys.stdout`/`sys.stderr` son
    `None`: cualquier cosa que escriba ahí revienta el proceso sin que nadie lo vea."""
    runtime_paths.logs.mkdir(parents=True, exist_ok=True)
    fichero = runtime_paths.logs / "app.log"
    manejador = RotatingFileHandler(fichero, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    asegurar_fichero_privado(fichero)
    manejador.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-5s  %(name)s  %(message)s"))
    raiz = logging.getLogger()
    _quitar_manejadores_sin_flujo(raiz)
    raiz.addHandler(manejador)
    raiz.setLevel(logging.INFO)
    if sys.stdout is None:
        sys.stdout = open(fichero, "a", encoding="utf-8", buffering=1)   # noqa: SIM115
    if sys.stderr is None:
        sys.stderr = open(fichero, "a", encoding="utf-8", buffering=1)   # noqa: SIM115


def _quitar_manejadores_sin_flujo(registro: logging.Logger) -> int:
    """Quita los manejadores de consola que apuntan a un flujo que no existe.

    `logger.py` configura la consola al importarse; empaquetada sin consola, `sys.stderr` era
    `None` en ese momento y cada mensaje acababa en un «--- Logging error ---» dentro del
    fichero de registro, tapando lo que de verdad importa.
    """
    quitados = 0
    for h in list(registro.handlers):
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler) \
                and getattr(h, "stream", None) is None:
            registro.removeHandler(h)
            quitados += 1
    return quitados


def _estado(url: str, tiempo: float = 1.5) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}/api/status", timeout=tiempo) as r:
            return json.loads(r.read(4096).decode("utf-8", "ignore"))
    except Exception:
        return None


def puerto_libre(host: str = NAV_HOST, puerto: int = NARSIL_PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, puerto))
            return True
        except OSError:
            return False


def esperar_puerto_libre(segundos: float = 15.0, host: str = NAV_HOST, puerto: int = NARSIL_PORT) -> bool:
    """Tras una actualización, la app nueva puede nacer mientras la vieja aún suelta el puerto:
    se le da margen en vez de morir con «el servidor local no ha arrancado»."""
    limite = time.monotonic() + segundos
    while True:
        if puerto_libre(host, puerto):
            return True
        if time.monotonic() >= limite:
            return False
        time.sleep(0.25)


def instancia_activa(url: str = URL_LOCAL) -> bool:
    """¿Ya hay una NARSIL Navegación sirviendo en el puerto?"""
    datos = _estado(url)
    return bool(datos and datos.get("app") == "narsil-navegacion")


class Servidor:
    """El servidor local en un hilo, con parada limpia."""

    def __init__(self) -> None:
        import uvicorn

        from .main import app

        config = uvicorn.Config(app, host=NAV_HOST, port=NARSIL_PORT, log_config=None,
                                access_log=False, log_level="info")
        self._servidor = uvicorn.Server(config)
        self.hilo = threading.Thread(target=self._servidor.run, name="servidor-local", daemon=True)

    def arrancar(self) -> None:
        self.hilo.start()

    def esperar(self, segundos: float = ESPERA_ARRANQUE) -> bool:
        limite = time.monotonic() + segundos
        while time.monotonic() < limite:
            if not self.hilo.is_alive():
                return False
            if _estado(URL_LOCAL, 0.8):
                return True
            time.sleep(0.2)
        return False

    def parar(self) -> None:
        self._servidor.should_exit = True
        self.hilo.join(timeout=8)


def _acompanar(servidor: Servidor) -> None:
    """Modo servidor: bloquea hasta Ctrl+C o hasta que el hilo muera, y para limpio."""
    try:
        while servidor.hilo.is_alive():
            servidor.hilo.join(timeout=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        servidor.parar()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    sin_ventana = "--sin-ventana" in argv
    _preparar_registro()
    log = logging.getLogger("narsil.lanzador")

    # Restos de la actualización anterior: el `.old` que la versión saliente no pudo borrar.
    if EMPAQUETADO:
        from . import actualizaciones
        if actualizaciones.limpiar_viejo(actualizaciones.ejecutable_actual()):
            log.info("Retirado el ejecutable de la versión anterior.")

    servidor: Servidor | None = None
    if instancia_activa():
        log.info("Ya hay una instancia sirviendo en %s: se abre una ventana sobre ella.", URL_LOCAL)
    else:
        if not puerto_libre():
            log.info("El puerto %s aún está ocupado (¿la versión anterior cerrándose?): se espera.", NARSIL_PORT)
            if not esperar_puerto_libre():
                log.error("El puerto %s sigue ocupado por otro proceso que no es esta app.", NARSIL_PORT)
                return 1
        servidor = Servidor()
        servidor.arrancar()
        def _soltar_todo() -> None:
            ventana.cerrar_todas()
            servidor.parar()
        ciclo.antes_de_cerrar = _soltar_todo

    def esperar_servidor() -> bool:
        if servidor is None:
            return True
        if servidor.esperar():
            log.info("Servidor local en %s (%s).", URL_LOCAL, "empaquetado" if EMPAQUETADO else "código fuente")
            return True
        log.error("El servidor local no ha arrancado en %s. Revisa %s.", URL_LOCAL,
                  runtime_paths.logs / "app.log")
        return False

    if sin_ventana or not ventana.disponible():
        if not esperar_servidor():
            return 1
        if not sin_ventana:
            log.warning("Sin motor de ventanas en este equipo: se abre en el navegador del sistema.")
            webbrowser.open(URL_LOCAL)
        if servidor is not None:
            _acompanar(servidor)
        return 0

    # La ventana se abre YA, sobre la pantalla de arranque, y navega a la interfaz cuando el
    # servidor contesta: la espera del arranque se viste, no se añade otra.
    arrancado = {"ok": False}

    def esperar() -> bool:
        arrancado["ok"] = esperar_servidor()
        return arrancado["ok"]

    try:
        almacen = runtime_paths.data / "webview"
        almacen.mkdir(parents=True, exist_ok=True)
        asegurar_directorio_privado(almacen)
        cargo = ventana.ejecutar(URL_LOCAL, ICONO, html_arranque=arranque.html_arranque(),
                                 esperar=esperar, minimo_arranque=arranque.MINIMO_VISIBLE,
                                 almacen=almacen)
        if not arrancado["ok"]:
            return 1
        if not cargo:
            log.warning("La ventana de la app no llegó a cargar: la interfaz se ha abierto en el navegador del sistema.")
            if servidor is not None:
                _acompanar(servidor)
                servidor = None
    except Exception as exc:   # el motor de ventanas ha fallado: que no se pierda la app
        log.error("No se pudo abrir la ventana de la app (%s): se abre en el navegador.", exc)
        if not arrancado["ok"] and not esperar_servidor():
            return 1
        webbrowser.open(URL_LOCAL)
        if servidor is not None:
            _acompanar(servidor)
            servidor = None
    finally:
        if servidor is not None:
            servidor.parar()
    return 0
