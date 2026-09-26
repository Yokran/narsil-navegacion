"""Botón «Buscar actualizaciones»: comprobar contra GitHub y, si el operador acepta, aplicar."""
from __future__ import annotations

import json
import os
import threading
from typing import Generator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .. import actualizaciones, ciclo
from ..config import EMPAQUETADO, REPO_GITHUB
from ..context import runtime_paths
from ..logger import logger
from .system import VERSION

router = APIRouter(prefix="/api/actualizaciones", tags=["actualizaciones"])

# Tras responder al botón «Cerrar la aplicación», la app se cierra del todo. Un segundo: lo
# justo para que la interfaz reciba la respuesta.
ESPERA_CIERRE = 1.0


@router.get("")
def comprobar():
    try:
        return actualizaciones.comprobar(VERSION)
    except actualizaciones.ActualizacionError as exc:
        raise HTTPException(502, str(exc))


@router.post("/aplicar")
def aplicar():
    """Descarga, verifica y deja el intercambio preparado. Eventos SSE con el progreso; el
    último dice si se reinicia o por qué no."""
    if not EMPAQUETADO:
        raise HTTPException(400, "Solo la app empaquetada se actualiza sola. Desde el código: git pull.")

    def generar() -> Generator[str, None, None]:
        def evento(**kw) -> str:
            return f"data: {json.dumps(kw, ensure_ascii=False)}\n\n"
        try:
            info = actualizaciones.comprobar(VERSION)
            if not info["disponible"]:
                yield evento(type="done", ok=False, message="Ya tiene la última versión.")
                return
            if not info["aplicable"]:
                yield evento(type="done", ok=False,
                             message="La versión nueva existe pero no trae ejecutable verificado para este equipo.")
                return
            yield evento(type="progress", pct=2, message=f"Descargando la versión {info['publicada']}…")
            with actualizaciones._abrir(info["url_sumas"]) as r:
                sumas = r.read(200_000).decode("utf-8", "ignore")
            sha = actualizaciones.leer_suma(sumas, info["artefacto"])
            carpeta = runtime_paths.data / "actualizaciones"
            destino = carpeta / (info["artefacto"] + ".nuevo")
            ultimo = {"pct": 2}

            def progreso(leido: int, total: int) -> None:
                if total:
                    ultimo["pct"] = 2 + int(leido / total * 90)

            # La descarga corre en un hilo para poder ir emitiendo el progreso.
            resultado: dict = {}

            def bajar() -> None:
                try:
                    actualizaciones.descargar(info["url_artefacto"], destino, sha, progreso)
                    resultado["ok"] = True
                except Exception as exc:     # se reporta al operador tal cual
                    resultado["error"] = str(exc)

            hilo = threading.Thread(target=bajar, daemon=True)
            hilo.start()
            emitido = -1
            while hilo.is_alive():
                hilo.join(0.3)
                if ultimo["pct"] != emitido:
                    emitido = ultimo["pct"]
                    yield evento(type="progress", pct=emitido, message="Descargando…")
            if "error" in resultado:
                yield evento(type="done", ok=False, message=resultado["error"])
                return
            yield evento(type="progress", pct=95, message="Suma SHA-256 verificada. Instalando…")
            exe = actualizaciones.ejecutable_actual()
            actualizaciones.intercambiar(exe, destino)
            logger.info(f"Actualización a {info['publicada']} instalada desde {REPO_GITHUB}; pendiente de que el operador cierre la app.")
            yield evento(type="done", ok=True, instalada=True,
                         message=f"Versión {info['publicada']} instalada. Cierre la aplicación y vuelva a abrirla.")
        except actualizaciones.ActualizacionError as exc:
            yield evento(type="done", ok=False, message=str(exc))
        except Exception as exc:
            logger.error(f"actualizar: {exc}")
            yield evento(type="done", ok=False, message="No se pudo aplicar la actualización.")

    return StreamingResponse(generar(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/cerrar")
def cerrar():
    """El botón «Cerrar la aplicación» tras instalar: se sueltan ventanas y puerto y se sale.
    El operador vuelve a abrirla desde su acceso directo, ya en la versión nueva."""
    def _salir() -> None:
        ciclo.preparar_relanzamiento()
        os._exit(0)
    threading.Timer(ESPERA_CIERRE, _salir).start()
    return {"ok": True}
