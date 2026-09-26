"""Recursos que viajan dentro del ejecutable y se vuelcan en la carpeta de datos.

Extensiones (Collector, newtab) y plantillas (`narsil-base`) son parte de la app: cada
versión trae las suyas. El navegador base, las identidades y los ajustes son del operador y
no se tocan. Desde el código fuente no hay nada que volcar: `backend/data/runtime` ya es la
carpeta de trabajo.
"""
from __future__ import annotations

import shutil
from pathlib import Path

CARPETAS = ("extensions", "templates")


def sincronizar_runtime(origen: Path, destino: Path) -> list[str]:
    """Copia `extensions/` y `templates/` de `origen` a `destino`, encima de lo que haya.

    Devuelve las carpetas copiadas. Se sobrescribe a propósito: si una versión nueva de la
    app trae una extensión nueva, la copia de trabajo tiene que ser la nueva. Los perfiles ya
    creados la refrescan al abrirse (por el `manifest.json`).
    """
    copiadas: list[str] = []
    for nombre in CARPETAS:
        fuente = origen / nombre
        if not fuente.is_dir():
            continue
        shutil.copytree(fuente, destino / nombre, dirs_exist_ok=True)
        copiadas.append(nombre)
    return copiadas
