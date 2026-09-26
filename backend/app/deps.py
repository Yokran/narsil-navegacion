"""Inyección de dependencias.

En la plataforma, `get_pm`/`get_pm_exec` resolvían el usuario de la sesión y comprobaban los
permisos `nav.view` / `nav.exec`. Aquí no hay sesión ni permisos que comprobar: la app corre
con el usuario del sistema operativo, que ya es la frontera. Se conservan los dos nombres para
que `api/profiles.py` no tenga que cambiar.
"""
from __future__ import annotations

from .context import pm
from .core.profile_manager import ProfileManager


def get_pm() -> ProfileManager:
    return pm


def get_pm_exec() -> ProfileManager:
    return pm
