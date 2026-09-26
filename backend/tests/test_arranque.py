"""Pantalla de arranque: autónoma, sin red, y la ventana navega a la interfaz solo cuando el
servidor contesta."""
from __future__ import annotations

import re
import sys
import threading
import types

import pytest

from app import arranque, ventana


# ── La pantalla ─────────────────────────────────────────────────────────────
def test_la_pantalla_lleva_el_escudo_el_nombre_y_el_cosmos():
    html = arranque.html_arranque()
    assert 'src="data:image/png;base64,' in html          # el escudo va incrustado
    assert ">NARSIL<" in html and "Navegación" in html
    assert "#090D18" in html                                # el abismo de la plataforma
    assert 'id="arranque-cosmos"' in html and "createRadialGradient" in html


def test_la_pantalla_no_pide_nada_fuera_del_proceso():
    """Mientras se ve no hay servidor: cualquier URL sería una petición perdida, y un puesto
    que opera identidades no le cuenta a nadie cuándo arranca. Ni siquiera al propio
    servidor local: las fuentes también van incrustadas."""
    html = arranque.html_arranque()
    urls = re.findall(r"""url\(['"]?([^'")]+)""", html) + re.findall(r"""src=['"]([^'"]+)""", html)
    assert urls and all(u.startswith("data:") for u in urls), [u for u in urls if not u.startswith("data:")]


def test_lanzador_e_interfaz_comparten_hoja_marcado_y_guion():
    """Si fueran dos pantallas, se vería el salto al navegar de una a otra. Son una."""
    from app.config import REPO_ROOT
    html = arranque.html_arranque()
    css = (REPO_ROOT / "ui" / "public" / "arranque.css").read_text(encoding="utf-8")
    js = (REPO_ROOT / "ui" / "public" / "arranque.js").read_text(encoding="utf-8")
    indice = (REPO_ROOT / "ui" / "index.html").read_text(encoding="utf-8")
    # la hoja entera, salvo las dos URL de fuentes que aquí son datos
    for linea in css.splitlines():
        if "url('/fonts/" not in linea:
            assert linea in html, linea
    assert js.strip() in html
    for pieza in ('class="arranque__caja"', 'class="arranque__marca">NARSIL<', 'class="arranque__barra"',
                  'id="arranque-cosmos"', 'class="cosmos__destello"'):
        assert pieza in html and pieza in indice, pieza


def test_la_coletilla_se_escapa():
    html = arranque.html_arranque(coletilla="<i>x</i>")
    assert "<i>x</i>" not in html


def test_no_pide_pulsar_ninguna_tecla():
    """Es una espera que ya existe, vestida; no una puerta."""
    # Sin los datos incrustados: 1,2 MB de base64 acaban conteniendo cualquier palabra corta
    # por azar (pasó al cambiar el escudo), y lo que se vigila es el marcado y el guion.
    html = re.sub(r"data:[^'\")]+", "", arranque.html_arranque()).lower()
    assert "tecla" not in html and "keydown" not in html and "click" not in html


# ── La ventana: un motor falso para no abrir nada ───────────────────────────
class _Eventos:
    def __init__(self):
        self.loaded = _Manejadores()


class _Manejadores:
    def __init__(self):
        self.fns = []

    def __iadd__(self, fn):
        self.fns.append(fn)
        return self

    def disparar(self):
        for fn in list(self.fns):
            fn()


class _Ventana:
    def __init__(self, registro, **kw):
        self.registro = registro
        self.kw = kw
        self.events = _Eventos()
        self._url = kw.get("url") or "about:blank"
        self.destruida = False

    def load_url(self, url):
        self.registro.append(("load_url", url))
        self._url = url
        # El motor real carga la página y dispara `loaded` un poco después.
        threading.Timer(0.02, self.events.loaded.disparar).start()

    def get_current_url(self):
        return self._url

    def destroy(self):
        self.destruida = True
        self.registro.append(("destroy",))


@pytest.fixture
def motor_falso(monkeypatch):
    registro: list = []
    ventanas: list[_Ventana] = []
    falso = types.ModuleType("webview")
    falso.settings = {}

    def create_window(title, url=None, html=None, **kw):
        v = _Ventana(registro, title=title, url=url, html=html, **kw)
        ventanas.append(v)
        registro.append(("create", "html" if html else "url"))
        return v

    def start(func=None, **kw):
        # Como el motor real: la primera pantalla ya está cargada cuando arranca `func`.
        ventanas[0].events.loaded.disparar()
        if func:
            func()
        # `start` bloquea hasta que se cierran las ventanas; aquí, hasta que acaba `func`.

    falso.create_window = create_window
    falso.start = start
    falso.screens = [types.SimpleNamespace(x=0, y=0, width=1920, height=1080)]
    monkeypatch.setitem(sys.modules, "webview", falso)
    monkeypatch.setattr(ventana, "ESPERA_CARGA", 1.0)
    return registro, ventanas


def test_se_abre_sobre_el_arranque_y_navega_cuando_el_servidor_contesta(motor_falso):
    registro, ventanas = motor_falso
    cargo = ventana.ejecutar("http://127.0.0.1:8420", html_arranque="<html>arranque</html>",
                             esperar=lambda: True, minimo_arranque=0.0)
    assert cargo is True
    assert registro[0] == ("create", "html")
    assert ("load_url", "http://127.0.0.1:8420") in registro
    assert not ventanas[0].destruida


def test_el_arranque_se_ve_al_menos_el_minimo_aunque_el_servidor_ya_este(motor_falso):
    import time
    registro, _ = motor_falso
    t0 = time.monotonic()
    ventana.ejecutar("http://127.0.0.1:8420", html_arranque="<html/>",
                     esperar=lambda: True, minimo_arranque=0.3)
    assert time.monotonic() - t0 >= 0.3


def test_si_el_servidor_no_arranca_se_cierra_la_ventana_sin_abrir_el_navegador(motor_falso):
    registro, ventanas = motor_falso
    abiertas: list[str] = []
    cargo = ventana.ejecutar("http://127.0.0.1:8420", html_arranque="<html/>",
                             esperar=lambda: False, minimo_arranque=0.0,
                             al_no_cargar=lambda u: abiertas.append(u))
    assert cargo is False
    assert ventanas[0].destruida
    assert ("load_url", "http://127.0.0.1:8420") not in registro
    assert abiertas == []


def test_la_carga_de_la_pantalla_de_arranque_no_cuenta_como_interfaz_cargada(motor_falso):
    """`loaded` se dispara también para la pantalla de arranque; si contara, el vigilante
    daría por cargada una interfaz que nunca llegó."""
    registro, ventanas = motor_falso
    abiertas: list[str] = []
    # Este motor no dispara `loaded` tras `load_url`: la interfaz nunca llega.
    ventanas_sin_carga = ventanas
    orig = _Ventana.load_url
    _Ventana.load_url = lambda self, url: (self.registro.append(("load_url", url)), setattr(self, "_url", url))
    try:
        cargo = ventana.ejecutar("http://127.0.0.1:8420", html_arranque="<html/>",
                                 esperar=lambda: True, minimo_arranque=0.0,
                                 al_no_cargar=lambda u: abiertas.append(u))
    finally:
        _Ventana.load_url = orig
    assert cargo is False
    assert abiertas == ["http://127.0.0.1:8420"]
    assert ventanas_sin_carga[0].destruida


def test_sin_pantalla_de_arranque_se_abre_directamente_sobre_la_interfaz(motor_falso):
    registro, _ = motor_falso
    cargo = ventana.ejecutar("http://127.0.0.1:8420")
    assert cargo is True
    assert registro[0] == ("create", "url")


def test_la_pantalla_no_hereda_metricas_del_documento():
    """En la interfaz el cuerpo lleva 14 px y 18 px de línea; en el lanzador no hay cuerpo. Sin
    fijar las métricas en la propia hoja, el escudo subía 1,8 px al cambiar de documento (visto
    por el Señor el 22-sep)."""
    from app.config import REPO_ROOT
    css = (REPO_ROOT / "ui" / "public" / "arranque.css").read_text(encoding="utf-8")
    regla = css[css.index(".arranque{"):css.index("}", css.index(".arranque{"))]
    assert "font-size:16px" in regla and "line-height:1.25" in regla
    assert "line-height:14px" in css[css.index(".arranque__coletilla{"):]
    assert "line-height:12px" in css[css.index(".arranque__pie{"):]


def test_la_ventana_nace_centrada_en_la_pantalla_principal(motor_falso):
    """En Windows, sin `screen`, la ventana salía abajo a la izquierda (visto por el Señor)."""
    registro, ventanas = motor_falso
    ventana.ejecutar("http://127.0.0.1:8420")
    kw = ventanas[0].kw
    assert kw["screen"].width == 1920 and kw["width"] == 1280 and kw["height"] == 840


def test_en_una_pantalla_pequena_la_ventana_se_encoge_para_caber(motor_falso, monkeypatch):
    import sys
    sys.modules["webview"].screens = [types.SimpleNamespace(x=0, y=0, width=1366, height=768)]
    registro, ventanas = motor_falso
    ventana.ejecutar("http://127.0.0.1:8420")
    kw = ventanas[0].kw
    assert kw["width"] <= 1366 * 0.92 and kw["height"] <= 768 * 0.9 and kw["screen"].width == 1366


def test_sin_informacion_de_pantalla_se_usa_el_tamano_de_diseno(motor_falso):
    import sys
    sys.modules["webview"].screens = []
    registro, ventanas = motor_falso
    ventana.ejecutar("http://127.0.0.1:8420")
    kw = ventanas[0].kw
    assert "screen" not in kw and kw["width"] == 1280
