"""Perfiles de identidad digital — API local del operador.

En la plataforma cada endpoint resolvía el usuario de la sesión y sus permisos. Aquí la app
corre en el equipo del operador y escucha sólo en 127.0.0.1: la frontera es la cuenta del
sistema operativo, y `get_pm` existe únicamente para no tener que tocar las firmas.

Lo que NO se hereda del preview es la confianza en los nombres. Allí `rename_profile`,
`save_template_from_profile` y `delete_template` metían en una ruta lo que llegara por la URL:
un `%2e%2e` bien puesto salía de `profiles/` y se llevaba por delante el runtime entero. Las
tres validan ahora como las demás.
"""
from __future__ import annotations

import json
import queue
import subprocess
import threading
from datetime import datetime
from pathlib import Path
from typing import Generator
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from ..context import runtime_paths
from ..core import firefox
from ..core.profile_manager import ProfileManager, is_valid_profile_name, asegurar_fichero_privado
from ..deps import get_pm, get_pm_exec
from ..logger import logger

router = APIRouter(prefix="/api/profiles", tags=["navigator"])


def _require_valid_name(name: str) -> None:
    """Rechaza nombres de perfil inválidos (incluye '.', '..') antes de tocar ficheros."""
    if not is_valid_profile_name(name):
        raise HTTPException(400, "Nombre de perfil inválido")


def _require_valid_url(url: str) -> str:
    """Devuelve una URL que se puede pasar a Firefox, o rebota con 400.

    Lo que llega aquí acaba en la línea de comandos del navegador. Firefox no distingue entre
    «una dirección que abrir» y «una opción»: si el primer carácter es un guion, lo trata como
    bandera. `--screenshot` escribe un PNG de cualquier página en disco, `-marionette` abre el
    puerto de automatización y deja conducir el navegador desde fuera, y `file:///` lee el disco
    del operador con la sesión de la identidad. Por eso no se filtran cadenas peligrosas —eso
    siempre se queda corto—: se exige positivamente http/https absoluta y se descarta el resto.
    """
    limpia = (url or "").strip()
    if not limpia:
        raise HTTPException(400, "URL vacía")
    if limpia.startswith("-"):
        raise HTTPException(400, "URL no válida: parece una opción de línea de comandos")
    trozos = urlparse(limpia)
    if trozos.scheme not in ("http", "https"):
        raise HTTPException(400, "URL no válida: sólo se admiten http:// y https://")
    if not trozos.netloc:
        raise HTTPException(400, "URL no válida: falta el servidor")
    return limpia


# ── Modelos ──────────────────────────────────────────────────────────────
class ProfileInfo(BaseModel):
    name: str
    has_avatar: bool
    avatar_url: str | None
    running: bool
    created_at: str


class ProfileMeta(BaseModel):
    category:    str       = ""   # OSINT | SOCMINT | V.HUMINT | OTROS
    description: str       = ""
    notes:       str       = ""
    credentials: str       = ""
    services:    list[str] = []


class CreateProfileRequest(BaseModel):
    name: str
    template: str = "narsil-base"


class RenameProfileRequest(BaseModel):
    name: str


class SaveTemplateRequest(BaseModel):
    template_name: str


class OpenProfileRequest(BaseModel):
    """Apertura opcionalmente dirigida a una URL. Sin `url`, va a la start page del perfil."""
    url: str | None = None


# ── Helpers ────────────────────────────────────────────────────────────────
def _profile_info(p: Path, pm: ProfileManager, en_ejecucion: set[str] | None = None) -> ProfileInfo:
    """Ficha de una identidad para la interfaz.

    `en_ejecucion` es el conjunto ya calculado de identidades abiertas. Se pasa desde el listado
    porque preguntarlo perfil a perfil significa un barrido completo de procesos por identidad, y
    la interfaz refresca cada cuatro segundos. Cuando no se pasa (una sola identidad), se
    pregunta por ella y punto.
    """
    avatar_url = None
    has_avatar = False
    for ext in ("png", "jpg", "jpeg", "webp"):
        if (p / f"avatar.{ext}").exists():
            has_avatar = True
            avatar_url = f"/api/profiles/{p.name}/avatar"
            break
    try:
        created_at = datetime.fromtimestamp(p.stat().st_ctime).strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        created_at = ""
    running = p.name in en_ejecucion if en_ejecucion is not None else pm.is_profile_running(p.name)
    return ProfileInfo(
        name=p.name, has_avatar=has_avatar, avatar_url=avatar_url,
        running=running, created_at=created_at,
    )


# ── Rutas fijas antes que las parametrizadas ────────────────────────────────
@router.get("/browser/status")
def browser_status(pm: ProfileManager = Depends(get_pm)):
    """Estado del navegador base.

    `installed` ya no basta: un Firefox *release* existe y arranca, pero ignora
    `xpinstall.signatures.required=false` y deja la extensión Collector fuera sin decir nada.
    Por eso se devuelve además `apto` y de dónde sale el binario.
    """
    exe = pm.base_exe()
    if not exe.exists():
        return {"installed": False, "exe": str(exe), "apto": False,
                "origen": None, "detalle": "No hay navegador base instalado."}
    apto, detalle = firefox.navegador_apto(exe)
    propio = exe.parent == pm.base_browser_dir
    return {"installed": True, "exe": str(exe), "apto": apto,
            "origen": "app" if propio else "sistema", "detalle": detalle}


@router.post("/browser/install")
def browser_install(pm: ProfileManager = Depends(get_pm_exec)):
    def generate() -> Generator[str, None, None]:
        q: queue.Queue[str] = queue.Queue()
        done_evt = threading.Event()

        def emit(evt_type: str, **kwargs) -> None:
            q.put(json.dumps({"type": evt_type, **kwargs}))

        def run() -> None:
            try:
                firefox.install_firefox(pm.base_browser_dir, emit)
            except Exception as exc:
                # Sin esto, un fallo que no previera `install_firefox` (un disco lleno al mover
                # el navegador a su sitio, un permiso) cerraba el stream SIN un solo evento: la
                # interfaz se quedaba con la última barra de progreso y ningún motivo. El
                # contrato del stream es que siempre termina en un `done`.
                logger.error(f"browser_install: {exc}")
                emit("done", ok=False, message=f"Error instalando el navegador: {exc}")
            finally:
                done_evt.set()

        threading.Thread(target=run, daemon=True).start()
        while not done_evt.is_set() or not q.empty():
            try:
                yield f"data: {q.get(timeout=0.1)}\n\n"
            except queue.Empty:
                pass

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/templates")
def list_templates(pm: ProfileManager = Depends(get_pm)):
    return pm.list_templates()


@router.post("/templates/save-from/{profile_name}")
def save_template_from_profile(profile_name: str, req: SaveTemplateRequest,
                               pm: ProfileManager = Depends(get_pm_exec)):
    _require_valid_name(profile_name)
    _require_valid_name(req.template_name.strip())
    try:
        synced = pm.save_template_from_profile(profile_name, req.template_name.strip())
        return {"ok": True, "synced": synced}
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"save_template_from_profile {profile_name}: {e}")
        raise HTTPException(500, "Error guardando template")


@router.delete("/templates/{template_name}")
def delete_template(template_name: str, pm: ProfileManager = Depends(get_pm_exec)):
    # Sin esto, `DELETE /api/profiles/templates/..%2f..%2f..` borraba el runtime completo:
    # extensión Collector, plantilla base y navegador.
    _require_valid_name(template_name)
    try:
        pm.delete_template(template_name)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(403, str(e))
    except Exception as e:
        logger.error(f"delete_template {template_name}: {e}")
        raise HTTPException(500, "Error eliminando template")


# ── CRUD de perfiles ────────────────────────────────────────────────────────
@router.get("")
def list_profiles(pm: ProfileManager = Depends(get_pm)):
    try:
        perfiles = pm.list_profiles()
        # Una sola pasada por los procesos para TODAS las identidades: preguntarlo una por una
        # costaba un barrido de /proc por identidad, y esto lo pide la interfaz cada 4 s.
        en_ejecucion = pm.perfiles_en_ejecucion(p.name for p in perfiles)
        return [_profile_info(p, pm, en_ejecucion) for p in perfiles]
    except Exception as e:
        logger.error(f"list_profiles: {e}")
        raise HTTPException(500, "Error listando perfiles")


@router.post("")
def create_profile(req: CreateProfileRequest, pm: ProfileManager = Depends(get_pm_exec)):
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Profile name cannot be empty")
    # Se valida ANTES de abrir el stream: un 400 se entiende, un SSE que termina en `ok:false`
    # hay que leerlo entero para enterarse.
    _require_valid_name(name)
    # Y la plantilla también, que es el otro nombre que acaba siendo una ruta. Sin esto,
    # `{"template": "../../../.ssh"}` copiaba ese directorio DENTRO del perfil nuevo: la
    # plantilla se copia entera, y da igual dónde esté.
    plantilla = (req.template or "").strip()
    if plantilla and not is_valid_profile_name(plantilla):
        raise HTTPException(400, "Nombre de plantilla inválido")

    def generate() -> Generator[str, None, None]:
        q: queue.Queue[str] = queue.Queue()
        done_evt = threading.Event()
        result_box: list = []

        def on_progress(current: int, total: int, message: str) -> None:
            pct = int(current / total * 100) if total > 0 else 0
            q.put(json.dumps({"type": "progress", "current": current,
                              "total": total, "pct": pct, "message": message}))

        def run() -> None:
            try:
                target = pm.create_profile(name, template_name=plantilla, progress_cb=on_progress)
                firefox.inject_profile_identity(target, name, runtime_paths, reset_extension_registry=True)
                result_box.append({"ok": True, "message": f"Perfil '{name}' creado."})
            except Exception as exc:
                result_box.append({"ok": False, "message": str(exc)})
            finally:
                done_evt.set()

        yield f"data: {json.dumps({'type': 'start', 'name': name})}\n\n"
        threading.Thread(target=run, daemon=True).start()
        while not done_evt.is_set() or not q.empty():
            try:
                yield f"data: {q.get(timeout=0.1)}\n\n"
            except queue.Empty:
                pass
        res = result_box[0] if result_box else {"ok": False, "message": "Unknown error"}
        yield f"data: {json.dumps({'type': 'done', **res})}\n\n"

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/{name}")
def delete_profile(name: str, pm: ProfileManager = Depends(get_pm_exec)):
    _require_valid_name(name)
    try:
        pm.delete_profile(name)
        logger.info(f"Deleted profile: {name}")
        return {"ok": True}
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except Exception as e:
        logger.error(f"delete_profile {name}: {e}")
        raise HTTPException(500, "Error eliminando perfil")


@router.patch("/{name}")
def rename_profile(name: str, req: RenameProfileRequest, pm: ProfileManager = Depends(get_pm_exec)):
    # El de la URL también: `PATCH /api/profiles/..%2f..%2fruntime` renombraba directorios
    # fuera de `profiles/` en el preview.
    _require_valid_name(name)
    new_name = req.name.strip()
    if not new_name:
        raise HTTPException(400, "El nuevo nombre del perfil esta vacio")
    _require_valid_name(new_name)
    try:
        target = pm.rename_profile(name, new_name)
        firefox.inject_profile_identity(
            pm.profile_data_dir(new_name), new_name, runtime_paths, reset_extension_registry=True
        )
        return {"ok": True, "profile": _profile_info(target, pm)}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except Exception as e:
        logger.error(f"rename_profile {name} -> {new_name}: {e}")
        raise HTTPException(500, "Error renombrando perfil")


@router.post("/{name}/open")
def open_profile(name: str, req: OpenProfileRequest | None = None,
                 pm: ProfileManager = Depends(get_pm_exec)):
    _require_valid_name(name)
    # Si el campo viene, se valida aunque llegue vacío: aceptar en silencio un `url: ""` sería
    # decidir por el cliente qué quiso decir. Sin campo `url`, la identidad va a su start page.
    destino = _require_valid_url(req.url) if (req is not None and req.url is not None) else None

    exe = pm.base_exe()
    if not exe.exists():
        raise HTTPException(404, "Firefox no encontrado. Instala Firefox ESR en data/runtime/base_browser/")
    profile_dir = pm.profile_data_dir(name)
    if not profile_dir.exists():
        # Firefox exige que la carpeta EXISTA: con `-profile` sobre una ruta inexistente muere
        # con «Could not find profile folder» y el mensaje despista hacia el sandbox.
        raise HTTPException(404, f"Perfil no encontrado: {name}")

    apto, detalle = firefox.navegador_apto(exe)
    if not apto:
        # No se abre a medias: con un Firefox release la identidad arrancaría sin Collector y
        # el operador creería estar recogiendo cuando no recoge nada.
        raise HTTPException(409, f"El navegador base no sirve para operar. {detalle}")

    try:
        firefox.inject_profile_identity(profile_dir, name, runtime_paths)
        argumentos = [str(exe), "-profile", str(profile_dir), "-no-remote"]
        if destino:
            argumentos += ["-new-tab", destino]
        subprocess.Popen(
            argumentos,
            cwd=str(exe.parent),
            env=firefox.browser_env(),
        )
        logger.info(f"Perfil abierto: {name}" + (f" → {destino}" if destino else ""))
        return {"ok": True}
    except Exception as e:
        logger.error(f"open_profile {name}: {e}")
        raise HTTPException(500, "Error abriendo perfil")


# ── Avatar ───────────────────────────────────────────────────────────────
# Lo que se admite subir, y es la lista completa: la extensión del fichero que llega decidía
# el nombre del que se escribe en disco, así que un `retrato.html` acababa como `avatar.html`
# dentro de la carpeta de la identidad. No se servía, pero escribir lo que otro diga con el
# nombre que otro diga no es cosa de un avatar.
AVATAR_EXTENSIONES = (".png", ".jpg", ".jpeg", ".webp")
AVATAR_MAX_BYTES = 4 * 1024 * 1024      # 4 MB: un avatar es un retrato, no un disco duro


@router.post("/{name}/avatar")
async def upload_avatar(name: str, file: UploadFile = File(...),
                        pm: ProfileManager = Depends(get_pm_exec)):
    _require_valid_name(name)
    pdir = pm.profiles_dir / name
    if not pdir.exists():
        raise HTTPException(404, "Profile not found")
    ext = Path(file.filename or "avatar.png").suffix.lower()
    if ext not in AVATAR_EXTENSIONES:
        raise HTTPException(400, "Formato de avatar no admitido: usa PNG, JPG o WEBP")
    content = await file.read()
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(413, "El avatar ocupa más de 4 MB")
    target = pdir / f"avatar{ext}"
    try:
        target.write_bytes(content)
        asegurar_fichero_privado(target)
        return {"ok": True, "avatar_url": f"/api/profiles/{name}/avatar"}
    except Exception as e:
        logger.error(f"upload_avatar {name}: {e}")
        raise HTTPException(500, "Error guardando avatar")


@router.get("/{name}/avatar")
def get_avatar(name: str, pm: ProfileManager = Depends(get_pm)):
    _require_valid_name(name)
    pdir = pm.profiles_dir / name
    for ext in ("png", "jpg", "jpeg", "webp"):
        f = pdir / f"avatar.{ext}"
        if f.exists():
            return FileResponse(str(f))
    raise HTTPException(404, "No avatar")


# ── Meta (categoría, descripción, credenciales, servicios) ──────────────────
@router.get("/{name}/meta")
def get_profile_meta(name: str, pm: ProfileManager = Depends(get_pm)) -> dict:
    _require_valid_name(name)
    meta_file = pm.profiles_dir / name / "narsil_meta.json"
    data: dict = {}
    if meta_file.exists():
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    if not data.get("user_agent"):
        ua = firefox.read_user_agent(pm.profile_data_dir(name))
        if ua:
            data["user_agent"] = ua
    return data


@router.post("/{name}/meta")
def save_profile_meta(name: str, meta: ProfileMeta, pm: ProfileManager = Depends(get_pm_exec)) -> dict:
    _require_valid_name(name)
    pdir = pm.profiles_dir / name
    if not pdir.exists():
        raise HTTPException(404, f"Perfil '{name}' no encontrado")
    meta_file = pdir / "narsil_meta.json"
    existing: dict = {}
    if meta_file.exists():
        try:
            existing = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    existing.update(meta.model_dump())
    meta_file.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    asegurar_fichero_privado(meta_file)     # lleva credenciales en claro
    return {"ok": True}
