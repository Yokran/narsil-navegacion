"""Configuración de la app de navegación.

A diferencia de S.A.R.A., esto corre en el terminal del operador: escucha SOLO en
127.0.0.1 y su puerto es suyo. El nombre `NARSIL_PORT` se conserva porque el runtime de
perfiles (homepage, extensión newtab) lo importa tal cual desde `core/firefox.py`, que aquí
es copia literal del código ya probado en la plataforma.

La app se distribuye como UN fichero ejecutable (PyInstaller): la interfaz compilada y el
runtime de perfiles (extensión Collector, plantilla base) viajan dentro del ejecutable, y lo
que es del operador —identidades, navegador base, ajustes— vive en una carpeta `data` junto a
él. Este módulo es el único sitio que distingue «corriendo desde el código» de «corriendo
empaquetado».
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Puerto del servidor local de la app. Distinto del 7420 de S.A.R.A. para poder tener ambos
# levantados en la misma máquina durante la transición.
NARSIL_PORT = int(os.environ.get("NAV_PORT", "8420"))

# Escucha local y punto. Esta app no es un servicio de red: si alguien la expone, expone el
# control de todas las identidades del operador.
NAV_HOST = "127.0.0.1"

# S.A.R.A. (Supervised Autonomous Research Architecture) a la que se reporta lo recolectado.
# Vacío = modo autónomo (la app funciona sola).
NARSIL_NODE_URL = os.environ.get("NARSIL_NODE_URL", "").rstrip("/")

# Enlace a la información para obtener acceso completo a NARSIL Intelligence Platform, que se
# ofrece a quien intenta entrar en S.A.R.A. sin tenerla: el Módulo de navegación es de uso
# gratuito y descargable; el acceso completo lo concede el titular.
ENLACE_ACCESO = os.environ.get("NARSIL_ENLACE_ACCESO", "https://narsilintelligence.com/narsil-ip")

NOMBRE_APP = "NARSIL Navegacion"

# Repositorio público de GitHub del que salen las versiones (Releases). El actualizador solo
# consulta esto, y solo cuando el operador pulsa «Buscar actualizaciones»: la app no llama a
# casa por su cuenta. `NARSIL_REPO_GITHUB` permite apuntar a un espejo interno.
REPO_GITHUB = os.environ.get("NARSIL_REPO_GITHUB", "narsilintelligence/narsil-navegacion")

APP_ROOT = Path(__file__).resolve().parents[1]      # .../narsil-navegacion/backend
REPO_ROOT = APP_ROOT.parent

# ── Empaquetado (PyInstaller) ───────────────────────────────────────────────
# `sys.frozen` lo pone PyInstaller; `sys._MEIPASS` es la carpeta donde deja los recursos
# incrustados (la interfaz y el runtime de perfiles).
EMPAQUETADO = bool(getattr(sys, "frozen", False))
RECURSOS = Path(getattr(sys, "_MEIPASS", str(APP_ROOT)))
UI_DIST = (RECURSOS / "ui") if EMPAQUETADO else (REPO_ROOT / "ui" / "dist")
# Runtime que viaja dentro del ejecutable y se vuelca en `data/runtime` en cada arranque
# (extensiones y plantillas: son de la app, no del operador). `None` desde el código fuente.
RUNTIME_EMPAQUETADO: Path | None = (RECURSOS / "runtime") if EMPAQUETADO else None
# Icono de la ventana. Windows lo toma del propio .exe; GTK/Qt lo cargan de un fichero y no
# saben leer un .ico con capas PNG comprimidas, así que ahí va el PNG.
ICONO = RECURSOS / ("narsil.ico" if os.name == "nt" else "narsil-256.png")

# Dónde viven identidades y runtime. Se puede fijar con NAV_DATA_DIR; si no:
#   - desde el código: `backend/data` (cómodo para probar y llevarse la carpeta entera);
#   - empaquetado: `data` junto al ejecutable si esa carpeta se puede escribir (lo normal:
#     el operador lo lleva en su carpeta), y si no, el perfil del usuario (%LOCALAPPDATA%
#     en Windows, ~/.local/share en Linux).
NAV_DATA_DIR = os.environ.get("NAV_DATA_DIR", "")


def _se_puede_escribir(carpeta: Path) -> bool:
    try:
        carpeta.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=carpeta, prefix=".narsil-", delete=True):
            pass
        return True
    except OSError:
        return False


def _datos_del_usuario() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / NOMBRE_APP / "data"


def ruta_datos(ejecutable: str | None = None, empaquetado: bool | None = None) -> Path:
    """Carpeta de datos del operador. Los parámetros existen para las pruebas."""
    if NAV_DATA_DIR:
        return Path(NAV_DATA_DIR)
    if empaquetado is None:
        empaquetado = EMPAQUETADO
    if not empaquetado:
        return APP_ROOT / "data"
    junto = Path(ejecutable or sys.executable).resolve().parent / "data"
    if junto.exists() or _se_puede_escribir(junto.parent):
        return junto
    return _datos_del_usuario()
