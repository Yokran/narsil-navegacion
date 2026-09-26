"""App de navegación — servidor local.

Corre en el terminal del operador, escucha en 127.0.0.1 y sirve dos cosas: la API de perfiles
y la interfaz. El navegador de cada identidad sale por la red del operador (su VPN, su IP), que
es justo lo que un nodo centralizado no puede ofrecer: cuarenta identidades tras una sola IP
son cuarenta identidades correlacionadas.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import actualizaciones, profiles, system
from .config import NAV_HOST, NARSIL_PORT, RUNTIME_EMPAQUETADO, UI_DIST
from .context import runtime_paths
from .core.profile_manager import asegurar_directorio_privado
from .logger import logger
from .recursos import sincronizar_runtime
from .seguridad import GuardiaLocal

def _preparar_directorios() -> None:
    for d in (runtime_paths.profiles, runtime_paths.logs, runtime_paths.settings_dir,
              runtime_paths.templates_dir, runtime_paths.extensions_dir):
        d.mkdir(parents=True, exist_ok=True)
    # Los nombres de las identidades y la URL del nodo describen la operación del puesto: en
    # POSIX no tienen por qué ser legibles por las demás cuentas de la máquina.
    for d in (runtime_paths.profiles, runtime_paths.settings_dir, runtime_paths.logs):
        asegurar_directorio_privado(d)
    # Empaquetada, la app trae su runtime dentro: se vuelca encima del de la carpeta de datos
    # para que cada versión trabaje con SU extensión y SU plantilla.
    if RUNTIME_EMPAQUETADO is not None:
        copiadas = sincronizar_runtime(RUNTIME_EMPAQUETADO, runtime_paths.runtime)
        logger.info(f"Runtime empaquetado volcado en {runtime_paths.runtime}: {', '.join(copiadas) or 'nada'}")
    if not runtime_paths.base_browser.exists():
        logger.warn(f"No hay navegador base en {runtime_paths.base_browser}: "
                    "instálalo desde la app antes de crear identidades.")


@asynccontextmanager
async def _ciclo_de_vida(_app: FastAPI):
    """Arranque de la app. `lifespan` y no `@on_event`, que está deprecado y avisaba por consola
    en cada arranque — un aviso de fábrica en la primera pantalla que ve el operador."""
    _preparar_directorios()
    yield


# Sin /docs ni /openapi.json: publicaban el mapa de la API a cualquier página del equipo.
app = FastAPI(title="NARSIL — Navegación", version=system.VERSION,
              docs_url=None, redoc_url=None, openapi_url=None,
              lifespan=_ciclo_de_vida)

# Primero de todo: el navegador de cada identidad abre contenido hostil, y ese contenido puede
# hablar con este puerto. El guardia comprueba Host y origen antes de que la petición llegue a
# ninguna ruta, y pone las cabeceras de protección en la respuesta.
app.add_middleware(GuardiaLocal)


app.include_router(system.router)
app.include_router(profiles.router)
app.include_router(actualizaciones.router)


# ── Interfaz ────────────────────────────────────────────────────────────────
if UI_DIST.exists():
    _assets = UI_DIST / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    _UI_RAIZ = UI_DIST.resolve()

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        """Sirve la interfaz compilada, y NADA que esté fuera de `ui/dist`.

        El `..` no llega hasta aquí como `..`: viaja codificado (`%2e%2e`), el servidor lo
        descodifica antes de enrutar y el manejador lo recibe ya convertido. Sin comprobar el
        resultado, `GET /%2e%2e/%2e%2e/backend/app/config.py` devolvía el fichero, y con
        bastantes saltos, cualquier cosa legible por la cuenta del operador: `/etc/passwd`,
        `~/.ssh/known_hosts` o los propios perfiles. Se resuelve la ruta y se exige que caiga
        dentro de `ui/dist` — comparar cadenas no bastaría, porque un enlace simbólico dentro
        de `dist` volvería a salir fuera.
        """
        if full_path:
            try:
                candidate = (UI_DIST / full_path).resolve()
            except (OSError, ValueError, RuntimeError):
                candidate = None
            if (candidate is not None and candidate.is_file()
                    and candidate.is_relative_to(_UI_RAIZ)):
                return FileResponse(str(candidate))
        return FileResponse(str(UI_DIST / "index.html"))


def run() -> None:
    uvicorn.run(app, host=NAV_HOST, port=NARSIL_PORT, log_level="info")


if __name__ == "__main__":
    run()
