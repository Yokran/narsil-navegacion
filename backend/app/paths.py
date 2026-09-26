"""Rutas de la app. Sin tenants: un terminal, un operador, un juego de identidades.

El seam multi-tenant del nodo no existe aquí a propósito — el aislamiento entre operadores lo
da el sistema operativo, que para eso está. `AppPaths` mantiene los mismos nombres de
propiedad que en la plataforma para que `firefox.py` y `profile_manager.py` sigan siendo copia
literal.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import ruta_datos

# Se resuelve UNA vez al importar (ver `config.ruta_datos`): junto al código, junto al
# ejecutable, o en el perfil del usuario si esa carpeta no se puede escribir.
DATA_DIR = ruta_datos()


@dataclass(frozen=True)
class AppPaths:
    tenant: str = "default"     # ignorado; existe para no divergir de la firma del nodo

    @property
    def data(self) -> Path:
        return DATA_DIR

    @property
    def runtime(self) -> Path:
        return self.data / "runtime"

    @property
    def base_browser(self) -> Path:
        return self.runtime / "base_browser"

    @property
    def templates_dir(self) -> Path:
        return self.runtime / "templates"

    @property
    def extensions_dir(self) -> Path:
        return self.runtime / "extensions"

    @property
    def logs(self) -> Path:
        return self.data / "logs"

    @property
    def profiles(self) -> Path:
        return self.data / "profiles"

    @property
    def settings_dir(self) -> Path:
        return self.data / "settings"
