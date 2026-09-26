"""Actualización de la app desde las Releases de GitHub.

Tres piezas, y una regla que las gobierna: **nada se ejecuta sin verificar la suma**.

1. `comprobar()`: pregunta a la API de Releases cuál es la última versión publicada y si hay
   un artefacto para esta plataforma. Solo se llama cuando el operador pulsa el botón.
2. `descargar()`: baja el artefacto a `data/actualizaciones/` y comprueba su SHA-256 contra
   el fichero `SHA256SUMS` de la misma Release. Si no cuadra, se borra y no pasa nada más.
3. `intercambiar()`: la app aparta su propio ejecutable a `.old` y coloca el nuevo. No se
   relanza sola: avisa, el operador la cierra con un botón y la vuelve a abrir. La carpeta
   `data/` no se toca: es del operador y vive fuera del ejecutable.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Callable

from .config import REPO_GITHUB
from .core import firefox

API_ULTIMA = "https://api.github.com/repos/{repo}/releases/latest"
FICHERO_SUMAS = "SHA256SUMS"
TIMEOUT = 15.0
USER_AGENT = "NARSIL-Navegacion"

# Un artefacto por sistema y arquitectura, con el mismo nombre que dan `empaquetado/construir.*`.
ARTEFACTOS = {
    "windows-x86_64": "NARSIL Navegacion-windows-x86_64.exe",
    "windows-arm64":  "NARSIL Navegacion-windows-arm64.exe",
    "linux-x86_64":   "narsil-navegacion-linux-x86_64",
    "linux-aarch64":  "narsil-navegacion-linux-aarch64",
}


class ActualizacionError(Exception):
    """Algo impide comprobar o aplicar la actualización, dicho para el operador."""


# ── Versiones ───────────────────────────────────────────────────────────────
_VERSION_RE = re.compile(r"^v?(\d+(?:\.\d+)*)(?:-?(rc|beta|alpha)\.?(\d*))?$", re.I)


def clave_version(texto: str) -> tuple:
    """Clave ordenable de una versión: `1.0` > `1.0-rc3` > `1.0-rc2` > `0.9`."""
    m = _VERSION_RE.match((texto or "").strip())
    if not m:
        raise ActualizacionError(f"Versión no reconocible: {texto!r}")
    numeros = tuple(int(n) for n in m.group(1).split("."))
    numeros += (0,) * (4 - len(numeros))
    if m.group(2):
        previa = {"alpha": 0, "beta": 1, "rc": 2}[m.group(2).lower()]
        return numeros + (0, previa, int(m.group(3) or 0))
    return numeros + (1, 0, 0)


def hay_nueva(actual: str, publicada: str) -> bool:
    return clave_version(publicada) > clave_version(actual)


def nombre_artefacto(plataforma: str | None = None) -> str:
    plat = plataforma or firefox.plataforma()
    try:
        return ARTEFACTOS[plat]
    except KeyError:
        raise ActualizacionError(f"No hay ejecutable publicado para {plat}.")


# ── GitHub ──────────────────────────────────────────────────────────────────
def _abrir(url: str, timeout: float = TIMEOUT):
    peticion = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                                    "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(peticion, timeout=timeout)


def comprobar(actual: str, plataforma: str | None = None, abrir: Callable = None) -> dict:
    """Qué hay publicado y si es más nuevo que `actual`. Solo lee: no descarga nada."""
    abrir = abrir or _abrir
    try:
        with abrir(API_ULTIMA.format(repo=REPO_GITHUB)) as r:
            datos = json.loads(r.read(1_000_000).decode("utf-8", "ignore"))
    except ActualizacionError:
        raise
    except Exception as exc:
        raise ActualizacionError(f"No se pudo consultar GitHub ({exc.__class__.__name__}).")
    etiqueta = str(datos.get("tag_name") or "").strip()
    if not etiqueta:
        raise ActualizacionError("La respuesta de GitHub no trae ninguna versión.")
    publicada = etiqueta[1:] if etiqueta.lower().startswith("v") else etiqueta
    nombre = nombre_artefacto(plataforma)
    activos = [a for a in datos.get("assets") or [] if isinstance(a, dict)]
    artefacto = next((a for a in activos if _mismo_nombre(str(a.get("name") or ""), nombre)), None)
    sumas = next((a for a in activos if a.get("name") == FICHERO_SUMAS), None)
    return {
        "actual": actual,
        "publicada": publicada,
        "disponible": hay_nueva(actual, publicada),
        "notas": str(datos.get("body") or ""),
        "url_release": str(datos.get("html_url") or ""),
        "artefacto": nombre,
        "url_artefacto": str(artefacto.get("browser_download_url") or "") if artefacto else "",
        "tamano": int(artefacto.get("size") or 0) if artefacto else 0,
        "url_sumas": str(sumas.get("browser_download_url") or "") if sumas else "",
        # Sin artefacto para esta plataforma o sin sumas no se puede aplicar, solo avisar.
        "aplicable": bool(artefacto and sumas),
    }


def _mismo_nombre(a: str, b: str) -> bool:
    """GitHub publica los adjuntos con los espacios convertidos en puntos
    (`NARSIL Navegacion-…exe` → `NARSIL.Navegacion-…exe`), mientras que `SHA256SUMS` —hecho
    en el runner sobre los ficheros reales— conserva el espacio. Se comparan las dos formas."""
    return a.replace(" ", ".") == b.replace(" ", ".")


def leer_suma(texto_sumas: str, nombre: str) -> str:
    """El SHA-256 de `nombre` dentro de un `SHA256SUMS` (formato de `sha256sum`)."""
    for linea in texto_sumas.splitlines():
        partes = linea.strip().split(None, 1)
        if len(partes) == 2 and _mismo_nombre(partes[1].lstrip("*").strip(), nombre):
            return partes[0].lower()
    raise ActualizacionError(f"{FICHERO_SUMAS} no lleva la suma de {nombre}.")


def descargar(url: str, destino: Path, sha_esperada: str,
              progreso: Callable[[int, int], None] | None = None,
              abrir: Callable = None) -> Path:
    """Baja `url` a `destino` y exige que su SHA-256 sea `sha_esperada`; si no, lo borra."""
    abrir = abrir or _abrir
    destino.parent.mkdir(parents=True, exist_ok=True)
    resumen = hashlib.sha256()
    try:
        with abrir(url, 120.0) as r, open(destino, "wb") as f:
            total = int(r.headers.get("Content-Length", 0) or 0) if hasattr(r, "headers") else 0
            leido = 0
            while True:
                trozo = r.read(1 << 16)
                if not trozo:
                    break
                f.write(trozo)
                resumen.update(trozo)
                leido += len(trozo)
                if progreso:
                    progreso(leido, total)
    except Exception as exc:
        destino.unlink(missing_ok=True)
        raise ActualizacionError(f"La descarga falló ({exc.__class__.__name__}).")
    if resumen.hexdigest().lower() != sha_esperada.lower():
        destino.unlink(missing_ok=True)
        raise ActualizacionError("La suma SHA-256 del fichero descargado no coincide con la publicada. "
                                 "No se ha instalado nada.")
    return destino


# ── Intercambio del ejecutable ──────────────────────────────────────────────
#
# Se hace DESDE EL PROPIO PROCESO y sin ningún guion: Windows permite renombrar un ejecutable
# en marcha (no borrarlo), así que la app aparta su propio fichero a `.old` y pone el nuevo en
# su sitio. El `.old` lo borra la versión nueva al arrancar. **La app no se relanza sola**: al
# terminar avisa y ofrece cerrarse, y el operador la vuelve a abrir. Se decidió así el
# 22-sep-2026 tras tres fallos seguidos del relanzamiento automático —un PowerShell oculto que
# Defender tomó por un dropper, una carrera por el puerto local y la herencia de las variables
# del cargador de PyInstaller—: cada uno tenía arreglo, pero un clic del operador no falla en
# ningún antivirus ni en ningún equipo, y no hay que mantenerlo.

SUFIJO_VIEJO = ".old"


def intercambiar(exe: Path, nuevo: Path) -> Path:
    """Aparta `exe` a `.old` y deja `nuevo` en su lugar. Si el segundo paso falla, devuelve el
    viejo a su sitio: el operador nunca se queda sin app. Devuelve la ruta del `.old`."""
    viejo = exe.with_name(exe.name + SUFIJO_VIEJO)
    try:
        viejo.unlink()
    except FileNotFoundError:
        pass
    os.replace(exe, viejo)
    try:
        os.replace(nuevo, exe)
    except Exception as exc:
        os.replace(viejo, exe)
        raise ActualizacionError(f"No se pudo colocar el ejecutable nuevo ({exc.__class__.__name__}); "
                                 "se conserva el actual.")
    if os.name != "nt":
        os.chmod(exe, 0o755)
    return viejo


def limpiar_viejo(exe: Path) -> bool:
    """Al arrancar: borra el `.old` que dejó la actualización anterior, si lo hay."""
    viejo = exe.with_name(exe.name + SUFIJO_VIEJO)
    try:
        viejo.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False        # todavía bloqueado (el viejo aún cerrándose): a la próxima


def ejecutable_actual() -> Path:
    return Path(sys.executable).resolve()
