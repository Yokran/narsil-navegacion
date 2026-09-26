"""Estado de la app, ajuste de S.A.R.A. y start page del perfil.

Tres cosas que no son perfiles pero sin las cuales la app no se sostiene:

1. **Estado.** Qué somos y sobre qué corremos. La plataforma (`linux-aarch64`, `windows-x86_64`)
   la necesita la interfaz para hablar con propiedad de lo que va a descargar.
2. **S.A.R.A.** (Supervised Autonomous Research Architecture: el arnés y el resto de capas de
   NARSIL Intelligence Platform). La Navegación vive fuera de ella a propósito —cada identidad
   sale por la VPN del operador y no por la IP del servidor—, pero el operador sigue necesitando
   llegar al resto de la plataforma. Aquí se guarda dónde está, se comprueba si contesta y se abre.
3. **La start page** que carga el Firefox de cada identidad. El navegador operativo no habla con
   la app por ninguna otra vía, y no habla con nadie más: ni una fuente, ni un icono, ni un
   script de fuera. La del preview pedía tipografías a Google, con lo que cada identidad
   saludaba a Google nada más abrirse.
"""
from __future__ import annotations

import html as _html
import json
import re
import urllib.error
import urllib.request
import webbrowser

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .. import ajustes, ventana
from ..config import EMPAQUETADO, ENLACE_ACCESO
from ..context import runtime_paths
from ..core import firefox
from ..logger import logger

router = APIRouter(tags=["system"])

# Versión del producto. La que consulta el actualizador contra la etiqueta publicada en GitHub.
VERSION = "1.0"
APP = "narsil-navegacion"

# Sonda a S.A.R.A.: corta a propósito. Sólo responde a «¿está ahí?», y una interfaz que se queda
# pensando diez segundos por eso es peor que una que dice «no contesta» en dos.
TIMEOUT_SONDA = 2.5


class AjusteNodo(BaseModel):
    url: str = ""


# ── Estado ──────────────────────────────────────────────────────────────────
@router.get("/api/status")
def status():
    return {
        "status": "online",
        "app": APP,
        "version": VERSION,
        "node": ajustes.url_nodo(runtime_paths) or None,
        "platform": firefox.plataforma(),
        # ¿Corre en su propia ventana? La interfaz lo usa para decir dónde se abrirá S.A.R.A.
        "hosted": ventana.alojada(),
        "packaged": EMPAQUETADO,
        # A dónde se manda a quien no tiene S.A.R.A.: cómo obtener acceso completo a la plataforma.
        "acceso_url": ENLACE_ACCESO,
    }


# ── Navegador base ──────────────────────────────────────────────────────────
@router.get("/api/browser/check")
def browser_check():
    """Qué navegador se va a usar y si sirve.

    `origen` distingue el que trae la app del que ya estaba en la máquina, porque al operador le
    importa: si dice `sistema`, no hay nada que descargar.
    """
    propio = runtime_paths.base_browser / ("firefox.exe" if firefox.plataforma().startswith("windows") else "firefox")
    if propio.exists():
        apto, detalle = firefox.navegador_apto(propio)
        return {"found": True, "origen": "app", "exe": str(propio), "apto": apto, "detalle": detalle}
    del_sistema = firefox.firefox_del_sistema()
    if del_sistema:
        apto, detalle = firefox.navegador_apto(del_sistema)
        return {"found": True, "origen": "sistema", "exe": str(del_sistema), "apto": apto, "detalle": detalle}
    return {"found": False, "origen": None, "exe": str(propio), "apto": False,
            "detalle": "No hay Firefox ESR ni en la app ni en el sistema."}


# ── S.A.R.A. ─────────────────────────────────────────────────────────────
@router.get("/api/node")
def get_node():
    return {"url": ajustes.url_nodo(runtime_paths)}


@router.put("/api/node")
def set_node(req: AjusteNodo):
    try:
        guardada = ajustes.guardar_url_nodo(runtime_paths, req.url)
    except ajustes.UrlInvalida as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.error(f"set_node: {exc}")
        raise HTTPException(500, "No se pudo guardar la dirección de S.A.R.A.")
    logger.info(f"S.A.R.A. configurada: {guardada or '(modo autónomo)'}")
    return {"ok": True, "url": guardada}


@router.get("/api/node/probe")
def probe_node():
    """¿Contesta S.A.R.A.? Sonda desde el backend, no desde la interfaz.

    Desde el navegador sería una petición entre orígenes: fallaría por CORS aunque S.A.R.A.
    estuviera perfectamente vivo, y el operador leería «caído» donde no lo hay.
    """
    url = ajustes.url_nodo(runtime_paths)
    if not url:
        return {"configured": False, "reachable": False, "detail": "No hay ninguna S.A.R.A. configurada."}
    destino = f"{url}/api/status"
    try:
        peticion = urllib.request.Request(destino, headers={"User-Agent": "NARSIL-Navegacion"})
        with urllib.request.urlopen(peticion, timeout=TIMEOUT_SONDA) as resp:
            cuerpo = resp.read(4096)
        try:
            datos = json.loads(cuerpo.decode("utf-8", "ignore"))
        except Exception:
            datos = {}
        return {"configured": True, "reachable": True, "url": url,
                "version": datos.get("version"), "detail": "S.A.R.A. responde."}
    except urllib.error.HTTPError as exc:
        # Contesta, pero no lo que esperábamos: S.A.R.A. está, el endpoint quizá no.
        return {"configured": True, "reachable": True, "url": url,
                "detail": f"S.A.R.A. responde con HTTP {exc.code}."}
    except Exception as exc:
        return {"configured": True, "reachable": False, "url": url,
                "detail": f"S.A.R.A. no responde ({exc.__class__.__name__})."}


@router.post("/api/node/open")
def open_node():
    """Abre S.A.R.A. como el propio operador, nunca dentro de una identidad.

    Deliberado: la plataforma se consulta como uno mismo. Meter S.A.R.A. dentro de un perfil
    operativo mezclaría la sesión del analista con la de la identidad que está investigando.
    Si la app corre en su propia ventana, S.A.R.A. se abre en otra ventana de la app; si no
    (modo servidor), en el navegador personal.
    """
    url = ajustes.url_nodo(runtime_paths)
    if not url:
        raise HTTPException(400, "No hay ninguna S.A.R.A. configurada.")
    if ventana.abrir(url):
        return {"ok": True, "url": url, "ventana": True}
    try:
        abierto = webbrowser.open(url)
    except Exception as exc:
        logger.error(f"open_node: {exc}")
        raise HTTPException(500, "No se pudo abrir el navegador del sistema")
    if not abierto:
        raise HTTPException(500, "El sistema no tiene un navegador con el que abrirlo.")
    return {"ok": True, "url": url, "ventana": False}


@router.post("/api/enlace/acceso")
def abrir_enlace_acceso():
    """Abre la información de acceso completo en el navegador del sistema (fuera de la app y fuera de
    cualquier identidad). La URL es fija y del servidor: nada del cliente entra aquí."""
    try:
        # Viene del entorno del proceso: se valida como cualquier otra URL que acabe en
        # `webbrowser.open`, no vaya a ser un `file://` o un esquema con manejador.
        destino = ajustes.validar_url_nodo(ENLACE_ACCESO)
        if not destino:
            raise ajustes.UrlInvalida("vacío")
        abierto = webbrowser.open(destino)
    except ajustes.UrlInvalida as exc:
        logger.error(f"enlace_acceso inválido: {exc}")
        raise HTTPException(500, "El enlace de acceso configurado no es una URL http/https.")
    except Exception as exc:
        logger.error(f"enlace_acceso: {exc}")
        abierto = False
    if not abierto:
        raise HTTPException(500, "No se pudo abrir el navegador del sistema.")
    return {"ok": True, "url": ENLACE_ACCESO}


# ── Start page del perfil ───────────────────────────────────────────────────
def _prettify_slug(slug: str) -> str:
    return re.sub(r"[_]+", " ", slug).strip()


@router.get("/profile-start/{name}", response_class=HTMLResponse)
def profile_start_page(name: str):
    """Página de inicio dentro del navegador operativo del perfil.

    Todo lo que carga sale de 127.0.0.1: las tipografías y el escudo los sirve la propia app. Cero dominios externos — una identidad que al abrirse pide una fuente a
    un CDN acaba de contarle a ese CDN cuándo empieza a trabajar.
    """
    display = _html.escape(_prettify_slug(name))
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{display}</title>
<style>
  /* Tipografías servidas por la propia app (mismo origen). Si la interfaz aún no está
     compilada, el navegador cae al stack del sistema y la página sigue correcta. */
  @font-face {{ font-family:"Archivo"; font-style:normal; font-weight:600; font-display:swap;
    src:url("/fonts/Archivo-600-latin.woff2") format("woff2"); }}
  @font-face {{ font-family:"JetBrains Mono"; font-style:normal; font-weight:400; font-display:swap;
    src:url("/fonts/JetBrainsMono-400-latin.woff2") format("woff2"); }}

  *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
  body{{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:22px;background:#141B2E;color:#E4DED9;
    font-family:"Archivo","Helvetica Neue",Arial,sans-serif;
    background-image:radial-gradient(circle at 50% 28%,rgba(159,106,87,.10),transparent 62%)}}
  .escudo{{width:96px;height:96px;object-fit:contain;filter:drop-shadow(0 0 22px rgba(192,141,79,.28))}}
  .nombre{{font-size:27px;font-weight:600;letter-spacing:.34em;padding-left:.34em;color:#E4DED9}}
  .filete{{width:132px;height:2px;background:#9F6A57;border-radius:2px}}
  .sub{{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:11px;letter-spacing:.26em;color:#A89693;text-transform:uppercase}}
  .chapa{{margin-top:6px;padding:9px 20px;border:1px solid #3A4A6E;border-left:3px solid #9F6A57;
    border-radius:7px;background:#1D2742;font-family:"JetBrains Mono",ui-monospace,monospace;
    font-size:13px;color:#DEC1B7;letter-spacing:.11em;display:flex;align-items:center;gap:10px}}
  .punto{{width:7px;height:7px;border-radius:50%;background:#5FCB9B;flex:0 0 auto}}
  .pie{{position:fixed;bottom:18px;font-family:"JetBrains Mono",ui-monospace,monospace;
    font-size:10px;letter-spacing:.16em;color:#7D8CA6}}
</style></head>
<body>
  <!-- Escudo de marca servido por la propia app (mismo origen): ni una petición fuera de este equipo. -->
  <img class="escudo" src="/marca/escudo.png" alt="">
  <div class="nombre">NARSIL</div>
  <div class="filete"></div>
  <div class="sub">Navegación · Identidad operativa</div>
  <div class="chapa"><span class="punto"></span>{display}</div>
  <div class="pie">EL TRÁFICO DE ESTA IDENTIDAD SALE POR LA RED DE ESTE EQUIPO</div>
</body></html>"""
