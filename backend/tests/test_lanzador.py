"""Ejecutable único y ventana propia: rutas, runtime empaquetado, acceso al nodo y licencia."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import config, recursos, ventana
from app.api import system


# ── Dónde viven los datos ───────────────────────────────────────────────────
def test_desde_el_codigo_los_datos_van_junto_al_backend(monkeypatch):
    monkeypatch.setattr(config, "NAV_DATA_DIR", "")
    assert config.ruta_datos(empaquetado=False) == config.APP_ROOT / "data"


def test_empaquetado_los_datos_van_junto_al_ejecutable(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "NAV_DATA_DIR", "")
    exe = tmp_path / "NARSIL Navegacion.exe"
    exe.write_bytes(b"")
    assert config.ruta_datos(ejecutable=str(exe), empaquetado=True) == tmp_path / "data"


def test_empaquetado_en_carpeta_de_solo_lectura_cae_al_perfil_del_usuario(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "NAV_DATA_DIR", "")
    monkeypatch.setattr(config, "_se_puede_escribir", lambda _c: False)
    monkeypatch.setattr(config, "_datos_del_usuario", lambda: tmp_path / "perfil" / "data")
    exe = tmp_path / "programa" / "app.exe"
    assert config.ruta_datos(ejecutable=str(exe), empaquetado=True) == tmp_path / "perfil" / "data"


def test_nav_data_dir_manda_sobre_todo(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "NAV_DATA_DIR", str(tmp_path / "fijado"))
    assert config.ruta_datos(ejecutable="/x/app", empaquetado=True) == tmp_path / "fijado"


# ── El runtime que viaja dentro del ejecutable ──────────────────────────────
def test_el_runtime_empaquetado_se_vuelca_encima_y_no_toca_el_navegador(tmp_path):
    origen = tmp_path / "recursos" / "runtime"
    (origen / "extensions" / "narsil-intel@narsil.local").mkdir(parents=True)
    (origen / "extensions" / "narsil-intel@narsil.local" / "manifest.json").write_text('{"version":"9.9"}')
    (origen / "templates" / "narsil-base").mkdir(parents=True)
    (origen / "templates" / "narsil-base" / "user.js").write_text("nuevo")
    destino = tmp_path / "data" / "runtime"
    (destino / "extensions" / "narsil-intel@narsil.local").mkdir(parents=True)
    (destino / "extensions" / "narsil-intel@narsil.local" / "manifest.json").write_text('{"version":"1.0"}')
    (destino / "base_browser").mkdir(parents=True)
    (destino / "base_browser" / "firefox").write_text("binario del operador")

    copiadas = recursos.sincronizar_runtime(origen, destino)

    assert sorted(copiadas) == ["extensions", "templates"]
    assert json.loads((destino / "extensions" / "narsil-intel@narsil.local" / "manifest.json").read_text())["version"] == "9.9"
    assert (destino / "templates" / "narsil-base" / "user.js").read_text() == "nuevo"
    assert (destino / "base_browser" / "firefox").read_text() == "binario del operador"


def test_sin_runtime_empaquetado_no_se_copia_nada(tmp_path):
    assert recursos.sincronizar_runtime(tmp_path / "no-existe", tmp_path / "data") == []


# ── Estado y ventana ────────────────────────────────────────────────────────
def test_el_estado_dice_si_hay_ventana_y_cual_es_el_enlace(cliente):
    datos = cliente.get("/api/status").json()
    assert datos["app"] == "narsil-navegacion" and datos["version"]
    assert datos["hosted"] is False
    assert datos["packaged"] is False
    assert datos["acceso_url"] == config.ENLACE_ACCESO


def test_sin_ventana_el_nodo_se_abre_en_el_navegador_del_sistema(cliente, monkeypatch):
    abiertas: list[str] = []
    monkeypatch.setattr(system.webbrowser, "open", lambda url: abiertas.append(url) or True)
    assert cliente.put("/api/node", json={"url": "http://nodo.prueba:7420"}).status_code == 200
    r = cliente.post("/api/node/open")
    assert r.status_code == 200 and r.json()["ventana"] is False
    assert abiertas == ["http://nodo.prueba:7420"]


def test_con_ventana_el_nodo_se_abre_en_otra_ventana_de_la_app(cliente, monkeypatch):
    abiertas: list[tuple[str, str]] = []
    ventana.registrar_abridor(lambda url, titulo: abiertas.append((url, titulo)) or True)
    try:
        monkeypatch.setattr(system.webbrowser, "open", lambda _u: pytest.fail("no debe ir al navegador"))
        assert cliente.get("/api/status").json()["hosted"] is True
        cliente.put("/api/node", json={"url": "http://nodo.prueba:7420"})
        r = cliente.post("/api/node/open")
        assert r.status_code == 200 and r.json()["ventana"] is True
        assert abiertas == [("http://nodo.prueba:7420", ventana.TITULO_NODO)]
    finally:
        ventana.registrar_abridor(None)
    assert ventana.alojada() is False


def test_si_el_abridor_falla_se_cae_al_navegador(cliente, monkeypatch):
    def revienta(_u, _t):
        raise RuntimeError("motor caído")
    ventana.registrar_abridor(revienta)
    try:
        abiertas: list[str] = []
        monkeypatch.setattr(system.webbrowser, "open", lambda url: abiertas.append(url) or True)
        cliente.put("/api/node", json={"url": "http://nodo.prueba:7420"})
        assert cliente.post("/api/node/open").json()["ventana"] is False
        assert abiertas == ["http://nodo.prueba:7420"]
    finally:
        ventana.registrar_abridor(None)


def test_sin_nodo_no_hay_nada_que_abrir(cliente):
    cliente.put("/api/node", json={"url": ""})
    assert cliente.post("/api/node/open").status_code == 400


# ── Enlace comercial ────────────────────────────────────────────────────────
def test_el_enlace_de_licencia_es_fijo_y_sale_al_navegador_del_sistema(cliente, monkeypatch):
    abiertas: list[str] = []
    monkeypatch.setattr(system.webbrowser, "open", lambda url: abiertas.append(url) or True)
    r = cliente.post("/api/enlace/acceso", json={"url": "https://evil.example"})
    assert r.status_code == 200
    assert abiertas == [config.ENLACE_ACCESO]        # lo que mande el cliente no cuenta


def test_el_enlace_de_licencia_exige_origen_local(cliente, monkeypatch):
    monkeypatch.setattr(system.webbrowser, "open", lambda _u: pytest.fail("no debe abrirse"))
    r = cliente.post("/api/enlace/acceso", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


# ── Lanzador ────────────────────────────────────────────────────────────────
def test_instancia_activa_reconoce_solo_a_la_app(monkeypatch):
    from app import lanzador
    monkeypatch.setattr(lanzador, "_estado", lambda *_a, **_k: {"app": "narsil-navegacion", "version": "1.0"})
    assert lanzador.instancia_activa() is True
    monkeypatch.setattr(lanzador, "_estado", lambda *_a, **_k: {"status": "online", "version": "0.1.0"})   # el nodo
    assert lanzador.instancia_activa() is False
    monkeypatch.setattr(lanzador, "_estado", lambda *_a, **_k: None)
    assert lanzador.instancia_activa() is False


def test_el_icono_empaquetado_es_el_escudo():
    """El ejecutable lleva el escudo de marca como icono (Windows lo lee del .exe; GTK, del
    fichero que viaja dentro)."""
    ico = Path(__file__).resolve().parents[2] / "empaquetado" / "narsil.ico"
    assert ico.exists() and ico.stat().st_size > 1000
    assert ico.read_bytes()[:4] == b"\x00\x00\x01\x00"      # cabecera ICO


def test_los_manejadores_de_consola_sin_flujo_se_quitan():
    import logging
    from app import lanzador
    registro = logging.getLogger("prueba-manejadores")
    mudo = logging.StreamHandler()
    mudo.stream = None                       # lo que deja `basicConfig` con sys.stderr = None
    fichero = logging.FileHandler(str(Path(__file__).parent / "_registro_prueba.log"))
    registro.addHandler(mudo); registro.addHandler(fichero)
    try:
        assert lanzador._quitar_manejadores_sin_flujo(registro) == 1
        assert mudo not in registro.handlers and fichero in registro.handlers
    finally:
        registro.removeHandler(fichero); fichero.close()
        (Path(__file__).parent / "_registro_prueba.log").unlink(missing_ok=True)
