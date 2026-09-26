"""Lo que se escribe dentro del perfil al crearlo: prefs, badge, extensión y start page.

Son las cuatro cosas que convierten una carpeta de Firefox en una identidad operativa. Si
cualquiera falta, el navegador arranca igual —y ahí está el problema: parece que funciona.
"""
from __future__ import annotations

import re

import pytest

from app.core import firefox

PREFS_EXIGIDAS = [
    # Sin esto la extensión sin firmar no carga (y sólo lo respeta ESR).
    ('xpinstall.signatures.required', 'false'),
    # Sin esto Firefox desactiva solo las extensiones instaladas en el directorio del perfil.
    ('extensions.autoDisableScopes', '0'),
    # Telemetría: una identidad operativa no le cuenta a Mozilla por dónde anda.
    ('datareporting.healthreport.uploadEnabled', 'false'),
    ('toolkit.telemetry.enabled', 'false'),
    ('toolkit.telemetry.unified', 'false'),
    ('datareporting.policy.dataSubmissionEnabled', 'false'),
    # El badge de identidad necesita que Firefox lea userChrome.css.
    ('toolkit.legacyUserProfileCustomizations.stylesheets', 'true'),
    # El popup de traducción tapaba la página justo al capturar.
    ('browser.translations.automaticallyPopup', 'false'),
]


@pytest.fixture()
def perfil(runtime_limpio, tmp_path):
    destino = tmp_path / "Alias Uno" / "profile"
    destino.mkdir(parents=True)
    firefox.inject_profile_identity(destino, "Alias Uno", runtime_limpio,
                                    reset_extension_registry=True)
    return destino


@pytest.mark.parametrize("clave,valor", PREFS_EXIGIDAS)
def test_user_js_lleva_las_prefs(perfil, clave, valor):
    texto = (perfil / "user.js").read_text(encoding="utf-8")
    assert f'user_pref("{clave}", {valor});' in texto


def test_la_homepage_apunta_a_la_app_local(perfil):
    texto = (perfil / "user.js").read_text(encoding="utf-8")
    m = re.search(r'user_pref\("browser\.startup\.homepage", "([^"]+)"\);', texto)
    assert m, "El perfil tiene que arrancar en su start page"
    assert m.group(1).startswith("http://127.0.0.1:"), "Y esa página la sirve la app, nadie más"
    # El nombre se pasa a ASCII y se codifica: 'Alias Uno' → 'Alias%20Uno'.
    assert m.group(1).endswith("/profile-start/Alias%20Uno")


def test_el_badge_lleva_el_nombre_de_la_identidad(perfil):
    """El badge en la barra es lo que evita operar con la identidad equivocada."""
    css = (perfil / "chrome" / "userChrome.css").read_text(encoding="utf-8")
    assert 'content: "Alias Uno";' in css
    assert "#nav-bar::before" in css


def test_el_badge_lleva_la_paleta_de_la_plataforma(perfil):
    """El badge vive dentro del navegador, pero es interfaz de NARSIL y va con su marca.

    Aquí se coló la paleta del preview la primera vez: la app entera en navy y el badge en
    cian, que es exactamente el tipo de incoherencia que delata un producto cosido a trozos.
    """
    css = (perfil / "chrome" / "userChrome.css").read_text(encoding="utf-8")
    assert "#1D2742" in css              # superficie navy
    assert "#DEC1B7" in css              # brillo: el acento que SÍ se lee
    assert "#9F6A57" in css              # bronce, y sólo como filete lateral
    assert "color: #9F6A57" not in css   # el bronce nunca es color de letra
    for preview in ("#0d3349", "#4fc3f7", "#1a6a8a", "#00d1b2"):
        assert preview not in css, f"Queda paleta del preview en el badge: {preview}"


def test_la_extension_collector_queda_instalada(perfil):
    manifest = perfil / "extensions" / "narsil-intel@narsil.local" / "manifest.json"
    assert manifest.exists(), "Sin Collector la identidad navega pero no recoge"
    assert "NARSIL Intelligence Collector" in manifest.read_text(encoding="utf-8")


def test_la_nueva_pestana_va_a_la_start_page(perfil):
    newtab = perfil / "extensions" / "narsil-newtab@narsil.local" / "newtab.html"
    assert newtab.exists()
    contenido = newtab.read_text(encoding="utf-8")
    assert "127.0.0.1" in contenido
    assert "/profile-start/Alias%20Uno" in contenido


def test_el_slug_soporta_acentos():
    assert firefox.slug("Formación Ávila") == "Formacion Avila"
    assert "/" not in firefox.slug("a/b")


def test_crear_por_api_deja_el_perfil_en_disco(cliente, runtime_limpio, tmp_path, monkeypatch):
    """La ruta real de creación, de punta a punta, con SSE incluido."""
    from app.core import firefox as ff
    falso = tmp_path / "bb"
    falso.mkdir()
    exe = falso / "firefox"
    exe.write_bytes(b"\x7fELF")
    monkeypatch.setattr("app.core.profile_manager.ProfileManager.base_exe", lambda self: exe)

    r = cliente.post("/api/profiles", json={"name": "Prueba API", "template": "narsil-base"})
    assert r.status_code == 200, r.text
    assert '"ok": true' in r.text.replace("'", '"'), r.text[-400:]

    perfil = runtime_limpio.profiles / "Prueba API" / "profile"
    assert (perfil / "user.js").exists()
    assert (perfil / "extensions" / "narsil-intel@narsil.local" / "manifest.json").exists()
    assert ff  # el import se usa arriba; deja claro que la inyección la hace el módulo real


@pytest.mark.skipif(firefox.os.name == "nt", reason="Los permisos POSIX no aplican en Windows")
def test_el_perfil_queda_privado(cliente, runtime_limpio, tmp_path, monkeypatch):
    """0700: dentro hay cookies de sesión y credenciales guardadas."""
    falso = tmp_path / "bb2"
    falso.mkdir()
    exe = falso / "firefox"
    exe.write_bytes(b"\x7fELF")
    monkeypatch.setattr("app.core.profile_manager.ProfileManager.base_exe", lambda self: exe)

    cliente.post("/api/profiles", json={"name": "Privada", "template": "narsil-base"})
    raiz = runtime_limpio.profiles / "Privada"
    assert raiz.exists()
    assert oct(raiz.stat().st_mode & 0o777) == "0o700"
