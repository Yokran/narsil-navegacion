"""Identidad de perfil Firefox + instalación de Firefox ESR (Linux).

Portado de NARSIL-MVP (`server.py`): inyección de `user.js`, badge `userChrome.css` con el
nombre del perfil, instalación de la extensión NARSIL Intelligence Collector y del newtab
redirect, y prefs de UI iniciales. La instalación de Firefox usa el tarball ESR de Linux
(antes instalador `.exe` silencioso de Windows).
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import tempfile
import unicodedata
import urllib.request
from pathlib import Path
from urllib.parse import quote

from ..config import NARSIL_PORT
from ..paths import AppPaths


def slug(name: str) -> str:
    """ASCII-safe slug (Formación → Formacion) para URLs y prefs."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9 _\-\.\(\)]", "_", ascii_name).strip("_")


# ── Registro de extensiones (limpieza de rutas absolutas obsoletas) ─────────

def _reset_firefox_extension_registry(profile_dir: Path) -> None:
    for filename in (
        "extensions.json", "extensions.ini", "extensions.cache",
        "addonStartup.json.lz4", "addonStartup.json", "compatibility.ini",
    ):
        target = profile_dir / filename
        if target.exists():
            try:
                target.unlink()
            except OSError:
                pass
    for dirname in ("startupCache", "startup-cache"):
        target = profile_dir / dirname
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)


def _profile_extension_registry_has_stale_paths(profile_dir: Path) -> bool:
    registry = profile_dir / "extensions.json"
    if not registry.exists():
        return False
    try:
        text = registry.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False
    profile_root = str(profile_dir.parent.resolve())
    return ("narsil-intel@narsil.local.xpi" in text) and (profile_root not in text)


# ── Prefs de UI iniciales ───────────────────────────────────────────────────

_UI_PREF_SENTINEL = "browser.toolbars.bookmarks.visibility"

_DEFAULT_TOOLBAR_STATE = {
    "placements": {
        "widget-overflow-fixed-list": [],
        "unified-extensions-area": [],
        "nav-bar": [
            "back-button", "forward-button", "stop-reload-button",
            "customizableui-special-spring1", "vertical-spacer", "urlbar-container",
            "customizableui-special-spring2", "downloads-button",
            "unified-extensions-button", "narsil-intel_narsil_local-browser-action",
            # El menú de Firefox. Sin él, la barra queda sin acceso a Preferencias, Complementos
            # ni Historial: los botones no es que no respondan, es que no existen. Al declarar
            # `browser.uiCustomization.state` se sustituye la barra ENTERA, así que lo que no se
            # enumere aquí desaparece.
            "PanelUI-menu-button",
        ],
        "toolbar-menubar": ["menubar-items"],
        "TabsToolbar": ["firefox-view-button", "tabbrowser-tabs", "new-tab-button", "alltabs-button"],
        "PersonalToolbar": ["personal-bookmarks"],
    },
    "seen": ["narsil-intel_narsil_local-browser-action"],
    "dirtyAreaCache": ["nav-bar", "unified-extensions-area"],
    "currentVersion": 22,
    "newElementCount": 1,
}
_DEFAULT_UI_PREFS_RAW: dict[str, str] = {
    "browser.toolbars.bookmarks.visibility":  '"never"',
    "extensions.activeThemeID":               '"firefox-compact-dark@mozilla.org"',
    "browser.compactmode.show":               "true",
    "browser.uidensity":                      "1",
    "browser.tabs.inTitlebar":                "1",
    "browser.uiCustomization.state":
        json.dumps(json.dumps(_DEFAULT_TOOLBAR_STATE, separators=(",", ":"))),
}


def _repair_missing_menu_button(profile_dir: Path) -> None:
    """Devuelve el menú de Firefox a los perfiles que se crearon sin él.

    La barra se impone entera con `browser.uiCustomization.state`, así que un perfil creado
    mientras esa lista no incluía `PanelUI-menu-button` se quedó SIN acceso a Preferencias,
    Complementos ni Historial — y desde fuera parece que los botones «no responden», cuando lo
    que pasa es que no están. Como las prefs iniciales sólo se escriben una vez, sin esta
    reparación el arreglo no alcanzaría a los perfiles que ya existen.

    Se toca únicamente eso: se añade el botón al final de `nav-bar` y se respeta cualquier otra
    personalización que el operador haya hecho."""
    prefs_js = profile_dir / "prefs.js"
    if not prefs_js.exists():
        return
    try:
        texto = prefs_js.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return
    if "PanelUI-menu-button" in texto or "browser.uiCustomization.state" not in texto:
        return

    patron = re.compile(r'user_pref\("browser\.uiCustomization\.state",\s*(".*")\);')
    m = patron.search(texto)
    if not m:
        return
    try:
        estado = json.loads(json.loads(m.group(1)))
        navbar = estado.get("placements", {}).get("nav-bar")
        if not isinstance(navbar, list):
            return
        navbar.append("PanelUI-menu-button")
        nuevo = json.dumps(json.dumps(estado, separators=(",", ":")))
        prefs_js.write_text(texto.replace(m.group(0), f'user_pref("browser.uiCustomization.state", {nuevo});'),
                            encoding="utf-8")
    except Exception:
        return


def _apply_initial_ui_prefs(profile_dir: Path) -> None:
    prefs_js = profile_dir / "prefs.js"
    if prefs_js.exists():
        try:
            if _UI_PREF_SENTINEL in prefs_js.read_text(encoding="utf-8", errors="ignore"):
                _repair_missing_menu_button(profile_dir)
                return
        except Exception:
            return

    raw: dict[str, str] = dict(_DEFAULT_UI_PREFS_RAW)
    saved_file = profile_dir / "narsil_user_prefs.json"
    if saved_file.exists():
        try:
            raw.update(json.loads(saved_file.read_text(encoding="utf-8")))
        except Exception:
            pass

    lines = "".join(f'user_pref("{k}", {v});\n' for k, v in raw.items())
    try:
        existing = prefs_js.read_text(encoding="utf-8", errors="ignore") if prefs_js.exists() else ""
        prefs_js.write_text(existing + lines, encoding="utf-8")
    except Exception:
        pass


# ── Inyección de identidad ───────────────────────────────────────────────────

def inject_profile_identity(
    profile_dir: Path,
    profile_name: str,
    paths: AppPaths,
    *,
    reset_extension_registry: bool = False,
) -> None:
    """Escribe user.js, userChrome badge, newtab redirect e instala la extensión Collector."""
    if reset_extension_registry or _profile_extension_registry_has_stale_paths(profile_dir):
        _reset_firefox_extension_registry(profile_dir)

    # `quote` porque `slug()` admite espacios y paréntesis: sin codificar, la preferencia
    # guardaría una URL con un espacio crudo dentro.
    ruta_inicio = quote(slug(profile_name), safe="")
    homepage = f"http://127.0.0.1:{NARSIL_PORT}/profile-start/{ruta_inicio}"
    user_js = profile_dir / "user.js"
    user_js.write_text(
        'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);\n'
        f'user_pref("browser.startup.homepage", "{homepage}");\n'
        'user_pref("browser.startup.page", 1);\n'
        'user_pref("ui.systemUsesDarkTheme", 1);\n'
        'user_pref("layout.css.prefers-color-scheme.content-override", 0);\n'
        'user_pref("browser.aboutwelcome.enabled", false);\n'
        'user_pref("startup.homepage_welcome_url", "");\n'
        'user_pref("startup.homepage_welcome_url.additional", "");\n'
        'user_pref("browser.startup.homepage_override.mstone", "ignore");\n'
        'user_pref("browser.shell.checkDefaultBrowser", false);\n'
        'user_pref("browser.shell.didSkipDefaultBrowserCheckOnFirstRun", true);\n'
        'user_pref("datareporting.policy.dataSubmissionPolicyAccepted", true);\n'
        'user_pref("datareporting.policy.dataSubmissionPolicyAcceptedVersion", 2);\n'
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
        'user_pref("datareporting.healthreport.uploadEnabled", false);\n'
        'user_pref("xpinstall.signatures.required", false);\n'
        'user_pref("extensions.autoDisableScopes", 0);\n'
        # El popup de traducción se planta encima de la página en cuanto Firefox cree
        # detectar otro idioma. En una identidad operativa eso es un cartel tapando la
        # prueba justo cuando se está capturando, así que se apaga el ofrecimiento
        # automático (el menú manual sigue disponible).
        'user_pref("browser.translations.automaticallyPopup", false);\n'
        'user_pref("browser.newtabpage.enabled", false);\n'
        'user_pref("browser.newtabpage.activity-stream.showSponsored", false);\n'
        'user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);\n'
        'user_pref("browser.newtabpage.activity-stream.feeds.topsites", false);\n'
        'user_pref("browser.newtabpage.activity-stream.feeds.section.highlights", false);\n'
        'user_pref("identity.fxaccounts.enabled", false);\n'
        'user_pref("toolkit.telemetry.enabled", false);\n'
        'user_pref("toolkit.telemetry.unified", false);\n'
        'user_pref("extensions.getAddons.showPane", false);\n'
        'user_pref("extensions.htmlaboutaddons.recommendations.enabled", false);\n',
        encoding="utf-8",
    )

    _apply_initial_ui_prefs(profile_dir)

    for cache_name in ("startupCache", "startup-cache"):
        cache_dir = profile_dir / cache_name
        if cache_dir.exists():
            shutil.rmtree(cache_dir, ignore_errors=True)

    # newtab extension → redirige a la start page del perfil
    _EXT_ID = "narsil-newtab@narsil.local"
    ext_dir = profile_dir / "extensions" / _EXT_ID
    ext_dir.mkdir(parents=True, exist_ok=True)

    _ext_src = paths.templates_dir / "narsil-base" / "extensions" / _EXT_ID
    manifest_dst = ext_dir / "manifest.json"
    if not manifest_dst.exists():
        manifest_src = _ext_src / "manifest.json"
        if manifest_src.exists():
            shutil.copy2(str(manifest_src), str(manifest_dst))

    newtab_url = f"http://127.0.0.1:{NARSIL_PORT}/profile-start/{ruta_inicio}"
    (ext_dir / "newtab.html").write_text(
        "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">"
        f"<script>window.location.replace('{newtab_url}');</script>"
        "</head><body></body></html>\n",
        encoding="utf-8",
    )

    # Extensión NARSIL Intelligence Collector (xpi de release o dir descomprimido)
    _RUNTIME_EXTS = paths.extensions_dir
    if _RUNTIME_EXTS.exists():
        profile_exts = profile_dir / "extensions"
        profile_exts.mkdir(parents=True, exist_ok=True)

        xpi_ids = {p.stem for p in _RUNTIME_EXTS.glob("*.xpi") if p.is_file()}
        for src_xpi in _RUNTIME_EXTS.glob("*.xpi"):
            if not src_xpi.is_file():
                continue
            dst_xpi = profile_exts / src_xpi.name
            stale_dir = profile_exts / src_xpi.stem
            if stale_dir.exists() and stale_dir.is_dir():
                shutil.rmtree(str(stale_dir), ignore_errors=True)
            if dst_xpi.exists() and src_xpi.read_bytes() == dst_xpi.read_bytes():
                continue
            shutil.copy2(str(src_xpi), str(dst_xpi))

        for ext_src_dir in _RUNTIME_EXTS.iterdir():
            if not ext_src_dir.is_dir():
                continue
            ext_id = ext_src_dir.name
            if ext_id in xpi_ids:
                continue
            dst_dir = profile_exts / ext_id
            stale_xpi = profile_exts / f"{ext_id}.xpi"
            if stale_xpi.exists():
                stale_xpi.unlink()
            src_manifest = ext_src_dir / "manifest.json"
            dst_manifest = dst_dir / "manifest.json"
            if (dst_manifest.exists() and src_manifest.exists()
                    and src_manifest.read_bytes() == dst_manifest.read_bytes()):
                continue
            dst_dir.mkdir(parents=True, exist_ok=True)
            for src_file in ext_src_dir.rglob("*"):
                if not src_file.is_file():
                    continue
                rel = src_file.relative_to(ext_src_dir)
                dst_file = dst_dir / rel
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src_file), str(dst_file))

    # Badge permanente con el nombre del perfil en la toolbar
    chrome_dir = profile_dir / "chrome"
    chrome_dir.mkdir(exist_ok=True)
    # Paleta del manual v2.3, la misma que la plataforma: superficie navy, letra en brillo y
    # el bronce SÓLO como filete. El cobre sobre navy da 2,76:1 y no se lee; con el badge no
    # se juega, porque es lo único que impide operar con la identidad equivocada.
    (chrome_dir / "userChrome.css").write_text(
        '@namespace url("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");\n'
        "#nav-bar::before {\n"
        f'  content: "{profile_name}";\n'
        "  display: -moz-box;\n  -moz-box-align: center;\n  align-items: center;\n"
        "  align-self: center;\n  padding: 2px 9px;\n  margin: 0 4px;\n"
        "  background: #1D2742;\n  color: #DEC1B7;\n"
        "  font-family: 'JetBrains Mono', ui-monospace, monospace;\n"
        "  font-size: 11px;\n  font-weight: bold;\n  letter-spacing: 0.08em;\n"
        "  border-radius: 4px;\n  border: 1px solid #3A4A6E;\n"
        "  border-left: 3px solid #9F6A57;\n  pointer-events: none;\n"
        "}\n",
        encoding="utf-8",
    )


# Backend gráfico con el que se lanza el navegador. `auto` decide por el entorno; `wayland` y
# `x11` lo fuerzan. Existe porque bajo WSLg ninguno de los dos funciona del todo: en XWayland los
# menús emergentes no reciben eventos, y en Wayland nativo la ventana queda a medio decorar. En un
# Linux de escritorio —y en el appliance— `auto` es lo correcto.
BROWSER_GFX = os.environ.get("NARSIL_BROWSER_GFX", "auto").lower()


def browser_env() -> dict:
    """Entorno con el que se lanza Firefox.

    Sobre Wayland —y WSLg lo es— Firefox arranca por defecto en XWayland si nadie le dice lo
    contrario. Ahí la ventana se pinta y las páginas se navegan con normalidad, pero los **menús
    emergentes** del navegador (ajustes, complementos, temas, el desplegable de una extensión) son
    ventanas nativas de tipo popup y no reciben eventos: se pulsa el botón y no ocurre nada.

    Desde fuera el síntoma engaña —parece que el perfil está mal montado— y lleva a buscar el
    problema en las preferencias o en las extensiones, donde no está. Con `MOZ_ENABLE_WAYLAND=1`
    Firefox usa Wayland nativo y los popups vuelven a funcionar.

    Sólo se activa si hay sesión Wayland de verdad; en X11 puro se deja el entorno intacto."""
    env = dict(os.environ)
    if os.name == "nt":
        # Windows no tiene servidor gráfico que elegir: el entorno se pasa intacto.
        return env
    if BROWSER_GFX == "x11":
        # X11 puro: se esconde el socket de Wayland para que ni GTK ni Gecko lo encuentren.
        env["MOZ_ENABLE_WAYLAND"] = "0"
        env["GDK_BACKEND"] = "x11"
        env.pop("WAYLAND_DISPLAY", None)
        env.setdefault("DISPLAY", ":0")
    elif BROWSER_GFX == "wayland" or (BROWSER_GFX == "auto" and env.get("WAYLAND_DISPLAY")):
        env["MOZ_ENABLE_WAYLAND"] = "1"
    return env


def read_user_agent(profile_dir: Path) -> str:
    """Lee general.useragent.override de prefs.js si el operador lo ha fijado."""
    prefs = profile_dir / "prefs.js"
    if not prefs.exists():
        return ""
    try:
        for line in prefs.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'user_pref\("general\.useragent\.override",\s*"(.*)"\);', line.strip())
            if m:
                return m.group(1)
    except Exception:
        pass
    return ""


# ── ¿Sirve este Firefox? ────────────────────────────────────────────────────
#
# Sólo ESR (y Developer/Nightly) respetan `xpinstall.signatures.required=false`. Un Firefox
# release ignora esa preferencia: acepta el perfil, arranca sin una queja y deja la extensión
# Collector fuera. El fallo es MUDO — no hay error, no hay aviso, simplemente la identidad no
# recoge nada — así que la comprobación se hace antes de usar el binario, no después.


def _leer_ini(fichero: Path) -> dict[str, str]:
    """Lee un .ini de Mozilla como un diccionario plano clave→valor.

    Plano a propósito: sólo interesan `RemotingName`, `SourceRepository` y `Version`, y las
    claves no se repiten entre secciones en estos ficheros.
    """
    datos: dict[str, str] = {}
    try:
        for linea in fichero.read_text(encoding="utf-8", errors="ignore").splitlines():
            linea = linea.strip()
            if not linea or linea.startswith((";", "#", "[")):
                continue
            if "=" in linea:
                clave, _, valor = linea.partition("=")
                datos[clave.strip()] = valor.strip()
    except Exception:
        return {}
    return datos


def _canal_por_ini(dir_app: Path) -> tuple[bool | None, str]:
    """(es_esr, versión) leyendo application.ini / platform.ini. None = no se pudo saber."""
    for nombre in ("application.ini", "platform.ini"):
        datos = _leer_ini(dir_app / nombre)
        if not datos:
            continue
        version = datos.get("Version", "")
        firma = " ".join((datos.get("RemotingName", ""), datos.get("SourceRepository", ""),
                          datos.get("SourceStamp", ""), version)).lower()
        if "esr" in firma:
            return True, version
        if datos.get("RemotingName") or datos.get("SourceRepository"):
            return False, version
    return None, ""


def _canal_por_version(exe: Path) -> tuple[bool | None, str]:
    """Último recurso: `firefox --version`. Devuelve None si el binario no contesta."""
    try:
        proceso = subprocess.run([str(exe), "--version"], capture_output=True, timeout=30)
    except Exception:
        return None, ""
    salida = (proceso.stdout or b"").decode("utf-8", "ignore").strip()
    if not salida:
        return None, ""
    return ("esr" in salida.lower()), salida


def navegador_apto(exe: Path) -> tuple[bool, str]:
    """¿Este binario vale como navegador operativo? Devuelve (apto, motivo/versión).

    Vale si es ESR. No vale si es un Firefox release, porque la extensión no cargaría y nadie
    se enteraría. Si no hay forma de averiguar el canal, se dice y NO se da por bueno: es
    preferible un aviso a una identidad muda.
    """
    exe = Path(exe)
    if not exe.exists():
        return False, "No existe el binario."
    es_esr, version = _canal_por_ini(exe.parent)
    if es_esr is None:
        es_esr, version = _canal_por_version(exe)
    if es_esr is True:
        return True, version or "ESR"
    if es_esr is False:
        return False, (f"Es Firefox release ({version or 'versión desconocida'}), no ESR. "
                       "Un Firefox release ignora la preferencia de firma y la extensión "
                       "Collector no se cargaría, sin avisar.")
    return False, "No se pudo determinar el canal (ni application.ini ni --version)."


# Dónde mira la app antes de proponer una descarga de 300 MB. Se recorre en orden y se toma el
# primero que ADEMÁS de existir sea ESR: un `firefox` release en el PATH no cuenta.
_CANDIDATOS_LINUX = (
    "/usr/lib/firefox-esr/firefox",
    "/opt/firefox-esr/firefox",
    "/opt/firefox-esr",
    "/usr/lib/firefox/firefox",
)
_CANDIDATOS_WINDOWS = (
    r"C:\Program Files\Mozilla Firefox\firefox.exe",
    r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
)


def _candidatos_sistema() -> list[Path]:
    rutas: list[Path] = []
    if os.name == "nt":
        rutas += [Path(r) for r in _CANDIDATOS_WINDOWS]
    else:
        rutas += [Path(r) for r in _CANDIDATOS_LINUX]
        for nombre in ("firefox-esr", "firefox"):
            encontrado = shutil.which(nombre)
            if encontrado:
                try:
                    rutas.append(Path(encontrado).resolve())
                except Exception:
                    rutas.append(Path(encontrado))
    unicas: list[Path] = []
    for r in rutas:
        if r not in unicas:
            unicas.append(r)
    return unicas


def firefox_del_sistema() -> Path | None:
    """Firefox ESR ya instalado en la máquina, o None.

    Existe para no descargar lo que ya está: si el operador tiene el ESR de su distribución o
    el de Mozilla, la app lo usa tal cual. Los candidatos que resultan ser release se descartan
    en silencio — no son un error, simplemente no sirven.
    """
    for ruta in _candidatos_sistema():
        if not ruta.is_file():
            continue
        apto, _ = navegador_apto(ruta)
        if apto:
            return ruta
    return None


# ── Instalación de Firefox ESR ──────────────────────────────────────────────
#
# Cada sistema se sirve de una fuente distinta, y no por capricho:
#   · Windows      → el instalador oficial en modo silencioso contra nuestra carpeta
#                    (`/S /D=`). No es el Firefox del sistema: vive dentro de la app y no
#                    compite con el navegador personal del operador.
#   · Linux x86-64 → el tarball ESR oficial.
#   · Linux ARM64  → Mozilla NO publica ESR para ARM. Canonical sí, en el canal `esr/stable`
#                    del snap; se descarga y se extrae sin instalar el snap ni snapd.
#   · macOS        → pendiente (el DMG necesita montaje y firma).


def plataforma() -> str:
    """Identificador de plataforma con el que se decide de dónde sale el navegador."""
    sistema = platform.system().lower()
    maquina = platform.machine().lower()
    if sistema == "windows":
        # `machine()` devuelve ARM64 en los Surface/Snapdragon. Importa porque Mozilla publica
        # un binario distinto (`os=win64-aarch64`) y el de x86-64 correría emulado.
        return "windows-arm64" if maquina in ("arm64", "aarch64") else "windows-x86_64"
    if sistema == "darwin":
        return "macos-arm64" if maquina in ("arm64", "aarch64") else "macos-x86_64"
    if maquina in ("aarch64", "arm64"):
        return "linux-aarch64"
    return "linux-x86_64"


def _descargar(url: str, destino: Path, emit, tope_pct: int, etiqueta: str) -> None:
    peticion = urllib.request.Request(url, headers={"User-Agent": "NARSIL-Navegacion"})
    with urllib.request.urlopen(peticion, timeout=180) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        descargado = 0
        ultimo = -1
        with open(destino, "wb") as f:
            while True:
                trozo = resp.read(65536)
                if not trozo:
                    break
                f.write(trozo)
                descargado += len(trozo)
                if total:
                    pct = int(descargado / total * tope_pct)
                    if pct != ultimo:
                        ultimo = pct
                        mb, tb = descargado / 1_048_576, total / 1_048_576
                        emit("progress", pct=pct,
                             message=f"Descargando {etiqueta}... {mb:.1f} / {tb:.1f} MB")


def _volcar_en_base(origen: Path, base_dir: Path) -> None:
    """Mueve el contenido de `origen` a `base_dir`, reemplazando lo que hubiera."""
    base_dir.mkdir(parents=True, exist_ok=True)
    for item in origen.iterdir():
        destino = base_dir / item.name
        if destino.exists():
            if destino.is_dir():
                shutil.rmtree(destino, ignore_errors=True)
            else:
                destino.unlink()
        shutil.move(str(item), str(destino))


def _instalar_windows(base_dir: Path, emit, *, arco: str = "win64") -> None:
    """Instalador oficial de Mozilla en modo silencioso, contra nuestra propia carpeta.

    Se probó antes el MSI de despliegue con `msiexec /a`, que sería más limpio: devuelve 0 y
    **no extrae nada** (se copia a sí mismo). El MSI de Firefox no admite instalación
    administrativa, así que se usa el instalador NSIS con `/S /D=<ruta>`.

    Dos detalles que importan: `/D=` tiene que ser el ÚLTIMO argumento y va **sin comillas**
    aunque la ruta lleve espacios, así que la línea de comandos se compone a mano en vez de
    dejar que Python la entrecomille por nosotros.
    """
    # `arco` es `win64` (x86-64) o `win64-aarch64` (Windows sobre ARM). El segundo existe
    # desde ESR 115 y es un binario distinto, no el mismo emulado.
    url = ("https://download.mozilla.org/"
           f"?product=firefox-esr-latest-ssl&os={arco}&lang=es-ES")
    with tempfile.TemporaryDirectory() as tmpdir:
        instalador = Path(tmpdir) / "firefox-esr-setup.exe"
        try:
            _descargar(url, instalador, emit, 65, "Firefox ESR")
        except Exception as exc:
            emit("done", ok=False, message=f"Error descargando Firefox: {exc}")
            return

        emit("progress", pct=70, message="Instalando Firefox ESR...")
        base_dir.mkdir(parents=True, exist_ok=True)
        linea = f'"{instalador}" /S /D={base_dir}'
        try:
            proceso = subprocess.run(linea, capture_output=True, timeout=900)
            if proceso.returncode != 0:
                emit("done", ok=False,
                     message=f"El instalador devolvió {proceso.returncode}.")
                return
        except Exception as exc:
            emit("done", ok=False, message=f"Error ejecutando el instalador: {exc}")
            return

    if not (base_dir / "firefox.exe").exists():
        emit("done", ok=False, message=f"Instalación terminada pero no aparece firefox.exe en {base_dir}")
        return
    emit("done", ok=True, message="Firefox ESR instalado. ¡Listo para operar!")


def _instalar_linux_tarball(base_dir: Path, emit) -> None:
    url = ("https://download.mozilla.org/"
           "?product=firefox-esr-latest-ssl&os=linux64&lang=es-ES")
    with tempfile.TemporaryDirectory() as tmpdir:
        tarball = Path(tmpdir) / "firefox.tar.xz"
        try:
            _descargar(url, tarball, emit, 65, "Firefox ESR")
        except Exception as exc:
            emit("done", ok=False, message=f"Error descargando Firefox: {exc}")
            return

        emit("progress", pct=70, message="Extrayendo Firefox ESR...")
        extraido = Path(tmpdir) / "x"
        extraido.mkdir()
        try:
            subprocess.run(["tar", "-xJf", str(tarball), "-C", str(extraido)],
                           check=True, capture_output=True, timeout=300)
        except Exception as exc:
            emit("done", ok=False, message=f"Error extrayendo el tarball: {exc}")
            return

        interior = extraido / "firefox"
        if not interior.exists():
            emit("done", ok=False, message="El tarball no contiene la carpeta 'firefox'.")
            return
        _volcar_en_base(interior, base_dir)

    if not (base_dir / "firefox").exists():
        emit("done", ok=False, message=f"Instalación terminada pero no aparece el binario en {base_dir}")
        return
    emit("done", ok=True, message="Firefox ESR instalado. ¡Listo para operar!")


def _url_snap_esr_arm64() -> str:
    """URL de descarga del snap de Firefox ESR para ARM64, vía la API de Snapcraft."""
    peticion = urllib.request.Request(
        "https://api.snapcraft.io/v2/snaps/info/firefox",
        headers={"Snap-Device-Series": "16", "User-Agent": "NARSIL-Navegacion"},
    )
    with urllib.request.urlopen(peticion, timeout=60) as resp:
        datos = json.loads(resp.read().decode("utf-8"))
    for canal in datos.get("channel-map", []):
        c = canal.get("channel", {})
        if c.get("name") == "esr/stable" and c.get("architecture") == "arm64":
            url = canal.get("download", {}).get("url")
            if url:
                return url
    raise RuntimeError("Snapcraft no ofrece el canal esr/stable para arm64.")


def _instalar_linux_arm64(base_dir: Path, emit) -> None:
    if not shutil.which("unsquashfs"):
        emit("done", ok=False,
             message="Falta 'unsquashfs' (paquete squashfs-tools), necesario en ARM64.")
        return
    try:
        url = _url_snap_esr_arm64()
    except Exception as exc:
        emit("done", ok=False, message=f"No se pudo localizar el paquete ARM64: {exc}")
        return

    with tempfile.TemporaryDirectory() as tmpdir:
        snap = Path(tmpdir) / "firefox.snap"
        try:
            _descargar(url, snap, emit, 65, "Firefox ESR (ARM64)")
        except Exception as exc:
            emit("done", ok=False, message=f"Error descargando Firefox: {exc}")
            return

        emit("progress", pct=70, message="Extrayendo Firefox ESR...")
        extraido = Path(tmpdir) / "x"
        try:
            subprocess.run(["unsquashfs", "-d", str(extraido), str(snap)],
                           check=True, capture_output=True, timeout=600)
        except Exception as exc:
            emit("done", ok=False, message=f"Error extrayendo el paquete: {exc}")
            return

        encontrados = [p for p in extraido.rglob("firefox") if p.is_file()]
        if not encontrados:
            emit("done", ok=False, message="El paquete ARM64 no contiene el binario 'firefox'.")
            return
        _volcar_en_base(encontrados[0].parent, base_dir)

    if not (base_dir / "firefox").exists():
        emit("done", ok=False, message=f"Instalación terminada pero no aparece el binario en {base_dir}")
        return
    emit("done", ok=True, message="Firefox ESR instalado. ¡Listo para operar!")


def install_firefox(base_dir: Path, emit) -> None:
    """Instala el navegador base en `base_dir` según la plataforma."""
    destino = plataforma()
    emit("progress", pct=0, message=f"Iniciando descarga de Firefox ESR ({destino})...")
    if destino == "windows-x86_64":
        _instalar_windows(base_dir, emit)
    elif destino == "windows-arm64":
        _instalar_windows(base_dir, emit, arco="win64-aarch64")
    elif destino == "linux-x86_64":
        _instalar_linux_tarball(base_dir, emit)
    elif destino == "linux-aarch64":
        _instalar_linux_arm64(base_dir, emit)
    else:
        emit("done", ok=False,
             message=f"Plataforma sin soporte de instalación automática: {destino}. "
                     "Copia manualmente Firefox ESR en data/runtime/base_browser/.")
