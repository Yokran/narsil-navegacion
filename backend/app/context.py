"""Recursos de la app: paths de runtime y el gestor de perfiles único."""
from __future__ import annotations

from .core.profile_manager import ProfileManager
from .logger import logger
from .paths import AppPaths

runtime_paths = AppPaths()

pm = ProfileManager(
    profiles_dir=runtime_paths.profiles,
    base_browser_dir=runtime_paths.base_browser,
    templates_dir=runtime_paths.templates_dir,
    logger=logger,
)
