"""Gestión de perfiles de identidad digital (Firefox ESR) — puerto Linux.

Portado de NARSIL-MVP (`src/n26/core/profile_manager.py`). Se conserva íntegra la lógica de
plantillas, creación con progreso, borrado, renombrado y copia; se sustituye la detección de
procesos (antes PowerShell/Win32_Process) por un escaneo de `/proc`, y se retira la rama de
borrado específica de Windows. El Módulo de navegación mantiene todas sus capacidades.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Optional, Protocol

import psutil

_UI_PREF_KEYS = {
    "browser.toolbars.bookmarks.visibility",
    "browser.uiCustomization.state",
    "browser.uidensity",
    "extensions.activeThemeID",
    "browser.compactmode.show",
    "browser.tabs.inTitlebar",
}
_PREFS_LINE_RE = re.compile(r'user_pref\("([^"]+)",\s*(.*)\);$')


def _extract_ui_prefs(prefs_js: Path) -> dict[str, str]:
    """Extract user-customizable UI pref values (raw JS literals) from prefs.js."""
    result: dict[str, str] = {}
    try:
        for line in prefs_js.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = _PREFS_LINE_RE.match(line.strip())
            if m:
                key, raw_val = m.group(1), m.group(2).strip()
                if key in _UI_PREF_KEYS:
                    result[key] = raw_val
    except Exception:
        pass
    return result


def _misma_ruta(candidato: str, objetivo: str) -> bool:
    """Compara dos rutas como rutas, no como texto.

    En Windows la misma carpeta se escribe de varias maneras (mayúsculas distintas, barra
    normal o invertida), así que una comparación literal daría por parado un perfil que está
    abierto — y la app dejaría abrir dos veces la misma identidad.
    """
    try:
        a = Path(candidato).resolve()
    except Exception:
        return False
    b = Path(objetivo)
    try:
        return os.path.normcase(str(a)) == os.path.normcase(str(b))
    except Exception:
        return False


# `\Z` y no `$`: `$` admite un salto de línea final y «victima\n» pasaba por válido.
_VALID_NAME_RE = re.compile(r"^[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ _\-\.\(\)]{0,48}\Z")
# Nombres que Windows reserva como dispositivos: `CON`, `NUL`, `COM1`… no se pueden crear
# como carpeta y el fallo llegaba al operador como un 500 sin explicación.
_NOMBRES_RESERVADOS = frozenset(
    {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}
)

# Nombre del binario de Firefox dentro de `base_browser/`. En Windows lleva extensión; en
# Linux y macOS no. Se resuelve una vez al importar: la plataforma no cambia en caliente.
BASE_EXE_NAME      = "firefox.exe" if os.name == "nt" else "firefox"
PROFILE_SUBDIR     = "profile"
PROTECTED_TEMPLATE = "narsil-base"      # no se puede borrar ni sobrescribir por el usuario

ProgressCb = Callable[[int, int, str], None]
CancelCb   = Callable[[], bool]


class LoggerLike(Protocol):
    def info(self, msg: str) -> None: ...
    def warn(self, msg: str) -> None: ...
    def error(self, msg: str) -> None: ...


def asegurar_fichero_privado(ruta: Path) -> None:
    """Deja un fichero en 0600. Para lo que lleva credenciales, la URL del nodo o el registro:
    hoy los tapa el 0700 del directorio, pero si `data` viaja a un pendrive exFAT o a un
    recurso de red no hay directorio que valga y cada fichero tiene que valerse solo."""
    if os.name == "nt":
        return
    try:
        os.chmod(ruta, 0o600)
    except OSError:
        pass


def asegurar_directorio_privado(ruta: Path) -> None:
    """Deja SÓLO este directorio en 0700, sin recorrer lo que hay dentro.

    Para `profiles/`, `settings/` y `logs/`: lo que protege es el listado. Los nombres de las
    cuarenta identidades y la URL del nodo describen la operación del puesto, y con el umask
    habitual (022) nacerían legibles por cualquier otra cuenta de la máquina. Recursivo no:
    dentro hay perfiles de Firefox con miles de ficheros y esto corre en cada arranque.
    """
    if os.name == "nt":
        return
    try:
        os.chmod(ruta, 0o700)
    except OSError:
        pass


def asegurar_permisos_privados(ruta: Path) -> None:
    """Deja la carpeta de una identidad en 0700 (sólo su dueño) en sistemas POSIX.

    Dentro viven cookies de sesión, historial y credenciales guardadas. Con el umask habitual
    de muchas distribuciones (022) el directorio nacería legible por cualquier otra cuenta de
    la máquina, y en un equipo compartido eso basta para llevarse una identidad entera.
    En Windows no se toca: allí el control lo llevan las ACL heredadas del perfil de usuario.
    """
    if os.name == "nt":
        return
    try:
        os.chmod(ruta, 0o700)
        for hijo in ruta.rglob("*"):
            try:
                os.chmod(hijo, 0o700 if hijo.is_dir() else 0o600)
            except OSError:
                continue
    except OSError:
        pass


def sanitize_profile_name(name: str) -> str:
    return name.strip()


def is_valid_profile_name(name: str) -> bool:
    if not _VALID_NAME_RE.match(name):
        return False
    return name.split(".")[0].strip().upper() not in _NOMBRES_RESERVADOS


# ── Extension files that are safe to copy between profiles ─────────────────
_EXTENSION_ITEMS = [
    "extensions",
    "extension-preferences.json",
    "extension-settings.json",
    "browser-extension-data",
]


@dataclass(frozen=True)
class ProfileManager:
    profiles_dir: Path
    base_browser_dir: Path       # data/runtime/base_browser  (Firefox ESR binary)
    templates_dir: Path          # data/runtime/templates      (all profile templates)
    logger: Optional[LoggerLike] = None

    # ── Template helpers ───────────────────────────────────────────────────

    def template_dir(self, template_name: str) -> Path:
        return self.templates_dir / template_name

    def list_templates(self) -> list[dict]:
        """Return [{name, display, protected}] sorted: narsil-base first, rest alpha."""
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        result: list[dict] = []

        base = self.templates_dir / PROTECTED_TEMPLATE
        if base.exists() and base.is_dir():
            result.append({
                "name":      PROTECTED_TEMPLATE,
                "display":   "Narsil Browser Base",
                "protected": True,
            })

        for p in sorted(self.templates_dir.iterdir(), key=lambda x: x.name.lower()):
            if p.is_dir() and p.name != PROTECTED_TEMPLATE:
                result.append({
                    "name":      p.name,
                    "display":   p.name,
                    "protected": False,
                })

        return result

    def save_template_from_profile(self, profile_name: str, template_name: str) -> list[str]:
        """Copy extension files from a profile into a user template."""
        if template_name == PROTECTED_TEMPLATE:
            raise ValueError(
                f"La plantilla '{PROTECTED_TEMPLATE}' está protegida y no puede modificarse."
            )

        src = self.profile_data_dir(profile_name)
        if not src.exists():
            raise FileNotFoundError(f"Perfil no encontrado: {profile_name}")

        dst = self.template_dir(template_name)
        dst.mkdir(parents=True, exist_ok=True)

        synced: list[str] = []
        for item in _EXTENSION_ITEMS:
            s = src / item
            d = dst / item
            if not s.exists():
                continue
            try:
                if s.is_dir():
                    if d.exists():
                        shutil.rmtree(str(d))
                    shutil.copytree(str(s), str(d))
                else:
                    shutil.copy2(str(s), str(d))
                synced.append(item)
            except Exception as exc:
                if self.logger:
                    self.logger.error(f"save_template: skip '{item}': {exc}")

        prefs_js = src / "prefs.js"
        if prefs_js.exists():
            ui_prefs = _extract_ui_prefs(prefs_js)
            if ui_prefs:
                narsil_prefs_dst = dst / "narsil_user_prefs.json"
                try:
                    narsil_prefs_dst.write_text(
                        json.dumps(ui_prefs, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    synced.append("narsil_user_prefs.json")
                except Exception as exc:
                    if self.logger:
                        self.logger.error(f"save_template: could not write narsil_user_prefs.json: {exc}")

        if self.logger:
            self.logger.info(f"Template '{template_name}' saved from profile '{profile_name}': {synced}")
        return synced

    def delete_template(self, template_name: str) -> None:
        if template_name == PROTECTED_TEMPLATE:
            raise ValueError(
                f"La plantilla '{PROTECTED_TEMPLATE}' está protegida y no puede eliminarse."
            )
        tpl = self.template_dir(template_name)
        if tpl.exists():
            shutil.rmtree(str(tpl))
            if self.logger:
                self.logger.info(f"Template deleted: {template_name}")

    # ── Profile directory helpers ──────────────────────────────────────────

    def list_profiles(self) -> list[Path]:
        self.profiles_dir.mkdir(parents=True, exist_ok=True)
        return sorted(
            [p for p in self.profiles_dir.iterdir() if p.is_dir()],
            key=lambda p: p.name.lower(),
        )

    def profile_data_dir(self, profile_name: str) -> Path:
        return self.profiles_dir / profile_name / PROFILE_SUBDIR

    def base_exe(self) -> Path:
        """Binario de Firefox que se usa para todas las identidades.

        Orden: primero el que la app tiene en `data/runtime/base_browser/` —es el nuestro, de
        versión conocida—; si no está, un Firefox **ESR** ya instalado en la máquina, para no
        descargar 300 MB de algo que el operador ya tiene. Si tampoco, se devuelve la ruta
        propia (inexistente) para que quien llame enseñe el botón de instalación.

        Un Firefox *release* del sistema NO se devuelve: ignoraría la preferencia de firma y la
        extensión Collector no cargaría, en silencio. Eso lo decide `firefox.navegador_apto`.
        """
        propio = self.base_browser_dir / BASE_EXE_NAME
        if propio.exists():
            return propio
        from . import firefox
        del_sistema = firefox.firefox_del_sistema()
        return del_sistema if del_sistema else propio

    # ── Running detection ───────────────────────────────────────────────────

    def is_profile_running(self, profile_name: str) -> bool:
        return len(self.get_profile_running_pids(profile_name)) > 0

    def perfiles_en_ejecucion(self, nombres: Iterable[str]) -> set[str]:
        """Cuáles de estas identidades tienen un Firefox abierto, en UNA pasada por los procesos.

        `is_profile_running` recorre la tabla de procesos entera cada vez que se le pregunta. El
        listado de la interfaz lo pedía identidad por identidad y se refresca cada cuatro
        segundos: con cuarenta identidades son cuarenta barridos por refresco, y se nota en el
        equipo del operador. Aquí se barre una vez y se cruza contra las rutas de todas.

        La comparación es la misma que en `get_profile_running_pids` —ruta resuelta y
        `normcase`, no texto— porque en Windows la misma carpeta se escribe de varias maneras.
        """
        objetivos: dict[str, str] = {}
        for nombre in nombres:
            try:
                clave = os.path.normcase(str(self.profile_data_dir(nombre).resolve()))
            except Exception:
                continue
            objetivos[clave] = nombre
        if not objetivos:
            return set()

        corriendo: set[str] = set()
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                info = proc.info
                argv = info.get("cmdline") or []
                if not argv:
                    continue
                nombre_proc = (info.get("name") or "").lower()
                if "firefox" not in nombre_proc and "firefox" not in " ".join(argv).lower():
                    continue
                for arg in argv:
                    try:
                        clave = os.path.normcase(str(Path(arg).resolve()))
                    except Exception:
                        continue
                    encontrado = objetivos.get(clave)
                    if encontrado is not None:
                        corriendo.add(encontrado)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            except Exception:
                continue
        return corriendo

    def get_profile_running_pids(self, profile_name: str) -> list[int]:
        """PIDs del Firefox que corre con `-profile <dir>` de este perfil.

        Se compara contra la línea de comandos porque el binario es el mismo para todas las
        identidades: lo que distingue a una de otra es su carpeta de perfil. `psutil` da la
        cmdline igual en Linux, Windows y macOS, así que aquí no hay rama por sistema.

        Importa que esto NO se conforme con «hay un firefox vivo»: de esa confusión salió el
        incidente en el que cerrar un perfil mandaba SIGTERM al proceso equivocado.
        """
        profile_path = str(self.profile_data_dir(profile_name).resolve())
        pids: list[int] = []
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                info = proc.info
                argv = info.get("cmdline") or []
                if not argv:
                    continue
                nombre = (info.get("name") or "").lower()
                cmdline = " ".join(argv)
                if "firefox" not in nombre and "firefox" not in cmdline.lower():
                    continue
                if any(_misma_ruta(arg, profile_path) for arg in argv):
                    pids.append(int(info["pid"]))
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            except Exception:
                continue
        return pids

    # ── Rename / delete ─────────────────────────────────────────────────────

    def rename_profile(self, old_name: str, new_name: str) -> Path:
        old_name = sanitize_profile_name(old_name)
        new_name = sanitize_profile_name(new_name)
        if not old_name:
            raise ValueError("El perfil origen esta vacio.")
        if not new_name:
            raise ValueError("El nuevo nombre del perfil esta vacio.")
        if old_name == new_name:
            target = self.profiles_dir / old_name
            if not target.exists():
                raise FileNotFoundError(f"Perfil no encontrado: {old_name}")
            return target
        if not is_valid_profile_name(new_name):
            raise ValueError(
                "Nombre invalido. Usa letras/numeros y separadores simples: espacio _ - . ( )"
            )

        source = self.profiles_dir / old_name
        target = self.profiles_dir / new_name
        if not source.exists():
            raise FileNotFoundError(f"Perfil no encontrado: {old_name}")
        if self.is_profile_running(old_name):
            raise RuntimeError(
                "Este perfil esta activo. Cierra el navegador del perfil antes de cambiar su nombre."
            )
        if target.exists():
            raise FileExistsError(f"Ya existe un perfil llamado '{new_name}'.")

        source.rename(target)
        if self.logger:
            self.logger.info(f"Perfil renombrado: {old_name} -> {new_name}")
        return target

    def delete_profile(self, profile_name: str) -> None:
        profile_name = sanitize_profile_name(profile_name)
        target = self.profiles_dir / profile_name
        if not target.exists():
            return

        if self.is_profile_running(profile_name):
            raise RuntimeError(
                "Este perfil todavía está activo (Firefox sigue en ejecución).\n\n"
                "Cierra el navegador y vuelve a intentarlo."
            )

        # Aquí no se espera a que se cierre nada: si el perfil estuviera abierto, la línea de
        # arriba ya habría rebotado la petición. La espera que había antes no se alcanzaba nunca
        # y cobraba un barrido de procesos de más por cada borrado.
        def onerror(func, path, exc_info):
            exc = exc_info[1]
            if isinstance(exc, FileNotFoundError):
                return
            try:
                os.chmod(path, 0o700)
                func(path)
            except FileNotFoundError:
                return

        shutil.rmtree(target, onerror=onerror)
        if self.logger:
            self.logger.info(f"Perfil eliminado: {profile_name}")

    # ── Create profile ─────────────────────────────────────────────────────

    def create_profile(
        self,
        profile_name: str,
        template_name: str = PROTECTED_TEMPLATE,
        progress_cb: Optional[ProgressCb] = None,
        cancel_cb: Optional[CancelCb] = None,
    ) -> Path:
        profile_name = sanitize_profile_name(profile_name)

        if not profile_name:
            raise ValueError("El nombre del perfil está vacío.")
        if not is_valid_profile_name(profile_name):
            raise ValueError(
                "Nombre inválido. Usa letras/números y separadores simples: espacio _ - . ( )"
            )

        target = self.profile_data_dir(profile_name)
        if target.exists():
            raise FileExistsError(f"El perfil '{profile_name}' ya existe.")

        base_exe = self.base_exe()
        if not base_exe.exists():
            raise FileNotFoundError(
                f"No se encuentra Firefox en:\n{base_exe}\n\n"
                "Instala Firefox ESR en data/runtime/base_browser/"
            )

        target.parent.mkdir(parents=True, exist_ok=True)

        if self.logger:
            self.logger.info(f"Creando perfil '{profile_name}' desde plantilla '{template_name}' ...")

        tpl_dir = self.template_dir(template_name) if template_name else None

        if tpl_dir and tpl_dir.exists():
            try:
                self._copytree_with_progress(tpl_dir, target, progress_cb, cancel_cb)
            except Exception as e:
                try:
                    if target.exists():
                        shutil.rmtree(str(target))
                    profile_root = target.parent
                    if profile_root.exists() and not any(profile_root.iterdir()):
                        shutil.rmtree(str(profile_root))
                except Exception as cleanup_err:
                    if self.logger:
                        self.logger.error(f"Error limpiando perfil incompleto: {cleanup_err}")
                if self.logger:
                    self.logger.error(f"Error creando perfil '{profile_name}': {e}")
                raise
        else:
            target.mkdir(parents=True, exist_ok=True)
            if progress_cb:
                progress_cb(1, 1, "Directorio de perfil creado (sin plantilla).")

        asegurar_permisos_privados(target.parent)

        if self.logger:
            self.logger.info(f"Perfil '{profile_name}' listo: {target}")
        return target

    # ── Copy helper ────────────────────────────────────────────────────────

    def _copytree_with_progress(
        self,
        src: Path,
        dst: Path,
        progress_cb: Optional[ProgressCb],
        cancel_cb: Optional[CancelCb],
    ) -> None:
        if dst.exists():
            raise FileExistsError(f"Destino ya existe: {dst}")

        total = sum(len(files) for _, _, files in os.walk(src))
        if progress_cb:
            progress_cb(0, total, "Copiando plantilla de perfil...")

        copied = 0
        start_ts = time.time()

        for root, _dirs, files in os.walk(src):
            rel = Path(root).relative_to(src)
            target_root = dst / rel
            os.makedirs(str(target_root), exist_ok=True)
            for name in files:
                if cancel_cb and cancel_cb():
                    raise RuntimeError("Operación cancelada por el usuario.")
                shutil.copy2(str(Path(root) / name), str(target_root / name))
                copied += 1
                if progress_cb and (copied == 1 or copied % 50 == 0):
                    elapsed = max(time.time() - start_ts, 0.001)
                    eta = int(max(total - copied, 0) / (copied / elapsed))
                    progress_cb(copied, total, f"Copiando ({copied}/{total}) — ETA {eta}s")
