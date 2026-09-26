"""Guardia del servidor local.

Esta app escucha en 127.0.0.1, y eso se confunde a menudo con estar a salvo. No lo está: el
navegador de cada identidad abre por oficio contenido hostil, y una página abierta en una
identidad puede hablar con `http://127.0.0.1:8420` como cualquier otro cliente. Sin guardia,
una web cualquiera podía:

* **CSRF simple.** `fetch('http://127.0.0.1:8420/api/profiles/<alias>/open', {method:'POST',
  mode:'no-cors'})` no necesita permiso de CORS —no lleva cabeceras que obliguen a un
  preflight— y lanza la identidad que quiera. Lo mismo con `/api/node/open` y con la
  instalación del navegador (300 MB por sorpresa).
* **DNS rebinding.** `evil.com` resuelve a la IP del atacante, la página carga, y su DNS
  vuelve a resolver a 127.0.0.1. A partir de ahí `http://evil.com:8420` es MISMO ORIGEN para
  el navegador: el atacante lee el inventario completo de identidades, sus metadatos —donde
  el operador guarda credenciales veladas— y la URL del nodo. Y escribe: crear, renombrar,
  borrar y, sobre todo, apuntar el botón «Abrir NARSIL» a un nodo falso.

La defensa es proporcional y no depende de tokens que haya que repartir:

1. **Host.** Se atiende sólo si la petición dice venir de un nombre de loopback. En un
   rebinding la cabecera es `Host: evil.com`, y ahí se acaba el ataque.
2. **Origin / Referer** en lo que muta estado. Un origen que no sea loopback se rechaza. Si no
   hay ninguno de los dos —curl, las pruebas, un script del propio operador— se deja pasar: el
   ataque que nos ocupa viene de un navegador, y un navegador SIEMPRE manda `Origin` en un
   POST/PUT/PATCH/DELETE.
3. **Sec-Fetch-Site.** Los navegadores actuales la mandan y un atacante no la puede falsear
   desde JavaScript. `cross-site` se rechaza en cualquier método, también en GET: cierra la
   puerta a las lecturas por `<img>`, `<script>` o navegación desde una web hostil.

Y de paso, las cabeceras de protección en todas las respuestas.
"""
from __future__ import annotations

from urllib.parse import urlparse

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .logger import logger

# Nombres que son este mismo equipo. Sin corchetes: `urlparse(...).hostname` ya los quita en
# IPv6, y la cabecera `Host` se normaliza igual antes de comparar.
NOMBRES_LOCALES = frozenset({"127.0.0.1", "localhost", "::1"})

METODOS_MUTANTES = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# `Sec-Fetch-Site` que sí son nuestras: la propia interfaz (`same-origin`), otro puerto del
# mismo equipo —el dev server de Vite— (`same-site`) y la navegación que escribe el operador
# a mano o desde un marcador (`none`).
SITIOS_PERMITIDOS = frozenset({"same-origin", "same-site", "none"})

# CSP cerrada: todo del propio origen. `unsafe-inline` sólo en estilos, porque la start page
# del perfil lleva su hoja incrustada y las fuentes de la marca se declaran ahí mismo.
CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

CABECERAS_SEGURIDAD = {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "geolocation=(), camera=(), microphone=(), interest-cohort=()",
}


def _nombre_local(nombre: str) -> bool:
    return nombre.strip().strip("[]").lower() in NOMBRES_LOCALES


def host_es_local(valor: str | None) -> bool:
    """¿La cabecera `Host` apunta a este equipo? (`127.0.0.1:8420`, `localhost`, `[::1]:8420`)"""
    if not valor:
        return False
    host = valor.strip()
    if host.startswith("["):                      # IPv6: [::1]:8420
        cierre = host.find("]")
        return cierre != -1 and _nombre_local(host[1:cierre])
    return _nombre_local(host.split(":", 1)[0])


def origen_es_local(valor: str | None) -> bool:
    """¿Este `Origin`/`Referer` es de la propia app? Cualquier puerto del loopback vale.

    El puerto no se fija a propósito: en desarrollo la interfaz se sirve desde el 5273 de Vite
    y llega con ese `Origin`. Quien pueda poner un origen de loopback ya está dentro del
    equipo, que es otra conversación.
    """
    if not valor:
        return False
    trozos = urlparse(valor.strip())
    if trozos.scheme not in ("http", "https"):
        return False
    return bool(trozos.hostname) and _nombre_local(trozos.hostname)


def motivo_de_rechazo(metodo: str, cabeceras: Headers, ruta: str = "") -> str | None:
    """Devuelve por qué se rechaza la petición, o None si es legítima. `ruta` es el path."""
    if not host_es_local(cabeceras.get("host")):
        return ("Esta app sólo atiende peticiones dirigidas a 127.0.0.1. "
                "La cabecera Host indica otro destino.")

    sitio = (cabeceras.get("sec-fetch-site") or "").strip().lower()
    if sitio and sitio not in SITIOS_PERMITIDOS:
        # Excepción medida: una NAVEGACIÓN de sólo lectura sí puede venir de otro sitio. La
        # nueva pestaña de cada identidad es una página `moz-extension://` que redirige a la
        # start page, y para el navegador eso es `cross-site`; bloquearla dejaría a las
        # identidades abriendo un error en vez de su portada. Lo que se sigue rechazando es lo
        # que de verdad explota una web hostil: `fetch`, XHR, `<img>`, `<script>` y cualquier
        # método que modifique estado. De una navegación no se puede leer la respuesta.
        # …pero NUNCA hacia la API: un `<iframe src="/api/node/probe">` desde una web hostil es
        # una navegación y pasaba. No leía la respuesta, pero medía cuánto tardaba (si el nodo
        # del operador contesta) y obligaba a la app a sondar o a barrer procesos a voluntad.
        navegacion_de_lectura = (
            metodo.upper() in ("GET", "HEAD")
            and (cabeceras.get("sec-fetch-mode") or "").strip().lower() == "navigate"
            and not ruta.startswith("/api/")
        )
        if not navegacion_de_lectura:
            return "Petición de otro sitio web rechazada."

    if metodo.upper() in METODOS_MUTANTES:
        origen = cabeceras.get("origin")
        if origen is not None:
            if not origen_es_local(origen):
                return "Origen no autorizado para una operación que modifica identidades."
        else:
            referer = cabeceras.get("referer")
            if referer and not origen_es_local(referer):
                return "Referer no autorizado para una operación que modifica identidades."
    return None


class GuardiaLocal:
    """Middleware ASGI puro.

    ASGI y no `BaseHTTPMiddleware` porque dos rutas de esta app son SSE (creación de perfil e
    instalación del navegador) y ahí el progreso tiene que salir según se produce, sin que
    nadie lo acumule por el camino.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        cabeceras = Headers(scope=scope)
        motivo = motivo_de_rechazo(scope.get("method", "GET"), cabeceras, scope.get("path", ""))
        if motivo:
            # Se registra el camino, no lo que mandó el atacante: la cabecera es suya y el log
            # es nuestro.
            logger.warn(f"Petición rechazada por el guardia local: {scope.get('path', '')}")
            respuesta = JSONResponse({"detail": motivo}, status_code=403)
            for clave, valor in CABECERAS_SEGURIDAD.items():
                respuesta.headers.setdefault(clave, valor)
            await respuesta(scope, receive, send)
            return

        es_api = str(scope.get("path", "")).startswith("/api/")

        async def enviar(mensaje: Message) -> None:
            if mensaje["type"] == "http.response.start":
                cab = MutableHeaders(scope=mensaje)
                for clave, valor in CABECERAS_SEGURIDAD.items():
                    cab.setdefault(clave, valor)
                if es_api:
                    # Metadatos de identidad y credenciales veladas no se quedan en la caché
                    # del navegador personal del operador.
                    cab.setdefault("cache-control", "no-store")
            await send(mensaje)

        await self.app(scope, receive, enviar)
