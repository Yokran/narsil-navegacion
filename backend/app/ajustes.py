"""Ajustes del operador, persistidos en disco.

Hoy sólo guarda una cosa: la dirección de S.A.R.A. a la que este operador se conecta. Merece
fichero propio porque es un dato del PUESTO, no del código: cada operador apunta a la S.A.R.A. de su
organización, y cambiarlo no puede exigir editar variables de entorno ni reinstalar nada.

Vive en `data/settings/app.json`, que está fuera de git por lo mismo que los perfiles: describe
la infraestructura interna de quien usa la app.
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from .config import NARSIL_NODE_URL
from .core.profile_manager import asegurar_fichero_privado
from .paths import AppPaths

_FICHERO = "app.json"


class UrlInvalida(ValueError):
    """La URL propuesta no es una URL de nodo utilizable."""


def validar_url_nodo(url: str) -> str:
    """Devuelve la URL normalizada o revienta con `UrlInvalida`.

    Se exige absoluta y http/https. Un `file://`, un `javascript:` o un texto suelto no son
    nodos: son una forma de que el botón «Abrir NARSIL» acabe abriendo lo que no debe, porque
    lo que aquí se guarda termina pasándose a `webbrowser.open` en la máquina del operador.
    """
    limpia = (url or "").strip().rstrip("/")
    if not limpia:
        return ""
    if len(limpia) > 2048:
        raise UrlInvalida("La dirección de S.A.R.A. es demasiado larga.")
    trozos = urlparse(limpia)
    if trozos.scheme not in ("http", "https"):
        raise UrlInvalida("La dirección de S.A.R.A. debe empezar por http:// o https://")
    if not trozos.netloc:
        raise UrlInvalida("La dirección de S.A.R.A. está incompleta: falta el servidor.")
    return limpia


def _ruta(paths: AppPaths) -> Path:
    return paths.settings_dir / _FICHERO


def leer(paths: AppPaths) -> dict:
    """Ajustes en disco; si no hay fichero, los que vengan del entorno."""
    fichero = _ruta(paths)
    datos: dict = {}
    if fichero.exists():
        try:
            cargado = json.loads(fichero.read_text(encoding="utf-8"))
            if isinstance(cargado, dict):
                datos = cargado
        except Exception:
            datos = {}
    if "node_url" not in datos:
        datos["node_url"] = NARSIL_NODE_URL
    return datos


def url_nodo(paths: AppPaths) -> str:
    """URL del nodo tal y como se va a usar: ya validada, o vacía si no hay o no vale."""
    try:
        return validar_url_nodo(str(leer(paths).get("node_url") or ""))
    except UrlInvalida:
        return ""


def guardar_url_nodo(paths: AppPaths, url: str) -> str:
    """Valida y persiste la URL del nodo. Devuelve la guardada (vacía = modo autónomo)."""
    limpia = validar_url_nodo(url)
    datos = leer(paths)
    datos["node_url"] = limpia
    paths.settings_dir.mkdir(parents=True, exist_ok=True)
    _ruta(paths).write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    asegurar_fichero_privado(_ruta(paths))
    return limpia
