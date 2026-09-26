"""`navegador_apto` tiene que distinguir un ESR de un Firefox release.

Es la comprobación más importante de la app y la menos vistosa. Un Firefox *release* acepta el
perfil, arranca sin una queja y **ignora** `xpinstall.signatures.required=false`: la extensión
Collector no se carga y no lo dice nadie. El operador cree que está recogiendo y no recoge nada.

Se prueba con `application.ini` de mentira en un directorio temporal, que es exactamente lo que
la función lee en la máquina real.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.core import firefox

INI_ESR = """; comentario que se ignora
[App]
Vendor=Mozilla
Name=Firefox
RemotingName=firefox-esr
Version=140.16.0
SourceRepository=https://hg.mozilla.org/releases/mozilla-esr140

[Gecko]
MinVersion=140.16.0
"""

INI_RELEASE = """[App]
Vendor=Mozilla
Name=Firefox
RemotingName=firefox
Version=143.0
SourceRepository=https://hg.mozilla.org/releases/mozilla-release
"""


def _falso_firefox(carpeta: Path, ini: str | None) -> Path:
    carpeta.mkdir(parents=True, exist_ok=True)
    exe = carpeta / ("firefox.exe" if firefox.os.name == "nt" else "firefox")
    exe.write_bytes(b"\x7fELF no soy un navegador de verdad\n")
    if ini is not None:
        (carpeta / "application.ini").write_text(ini, encoding="utf-8")
    return exe


def test_esr_es_apto(tmp_path):
    exe = _falso_firefox(tmp_path / "esr", INI_ESR)
    apto, detalle = firefox.navegador_apto(exe)
    assert apto is True
    assert "140.16.0" in detalle


def test_release_no_es_apto(tmp_path):
    exe = _falso_firefox(tmp_path / "release", INI_RELEASE)
    apto, detalle = firefox.navegador_apto(exe)
    assert apto is False
    assert "release" in detalle.lower()
    # El motivo tiene que explicar la consecuencia, no sólo el hecho.
    assert "extensión" in detalle.lower() or "collector" in detalle.lower()


def test_platform_ini_tambien_sirve(tmp_path):
    """Si no hay application.ini legible, vale platform.ini: en algunos empaquetados es el que está."""
    carpeta = tmp_path / "solo-platform"
    exe = _falso_firefox(carpeta, None)
    (carpeta / "platform.ini").write_text(
        "[Build]\nSourceRepository=https://hg.mozilla.org/releases/mozilla-esr140\nMilestone=140.16.0\n",
        encoding="utf-8")
    apto, _ = firefox.navegador_apto(exe)
    assert apto is True


def test_sin_ini_y_sin_poder_preguntar_no_se_da_por_bueno(tmp_path):
    """Ante la duda, NO. Un aviso molesta; una identidad muda cuesta una investigación."""
    exe = _falso_firefox(tmp_path / "opaco", None)
    apto, detalle = firefox.navegador_apto(exe)
    assert apto is False
    assert "canal" in detalle.lower()


def test_binario_inexistente(tmp_path):
    apto, detalle = firefox.navegador_apto(tmp_path / "no-existe" / "firefox")
    assert apto is False
    assert "existe" in detalle.lower()


def test_firefox_del_sistema_descarta_los_release(tmp_path, monkeypatch):
    """Un `firefox` release en el PATH no cuenta como navegador del sistema."""
    exe_release = _falso_firefox(tmp_path / "sistema-release", INI_RELEASE)
    monkeypatch.setattr(firefox, "_candidatos_sistema", lambda: [exe_release])
    assert firefox.firefox_del_sistema() is None


def test_firefox_del_sistema_acepta_el_esr(tmp_path, monkeypatch):
    exe_release = _falso_firefox(tmp_path / "sistema-release", INI_RELEASE)
    exe_esr = _falso_firefox(tmp_path / "sistema-esr", INI_ESR)
    # El release va primero en la lista: tiene que saltárselo, no quedarse con el primero que existe.
    monkeypatch.setattr(firefox, "_candidatos_sistema", lambda: [exe_release, exe_esr])
    assert firefox.firefox_del_sistema() == exe_esr


def test_la_app_prefiere_su_propio_navegador(tmp_path, monkeypatch):
    """El de `data/runtime/base_browser/` manda: es el nuestro y de versión conocida."""
    from app.core.profile_manager import ProfileManager

    propio_dir = tmp_path / "base_browser"
    propio = _falso_firefox(propio_dir, INI_ESR)
    del_sistema = _falso_firefox(tmp_path / "sistema", INI_ESR)
    monkeypatch.setattr(firefox, "_candidatos_sistema", lambda: [del_sistema])

    pm = ProfileManager(profiles_dir=tmp_path / "p", base_browser_dir=propio_dir,
                        templates_dir=tmp_path / "t")
    assert pm.base_exe() == propio


def test_sin_navegador_propio_se_usa_el_del_sistema(tmp_path, monkeypatch):
    from app.core.profile_manager import ProfileManager

    del_sistema = _falso_firefox(tmp_path / "sistema", INI_ESR)
    monkeypatch.setattr(firefox, "_candidatos_sistema", lambda: [del_sistema])

    pm = ProfileManager(profiles_dir=tmp_path / "p", base_browser_dir=tmp_path / "vacio",
                        templates_dir=tmp_path / "t")
    assert pm.base_exe() == del_sistema


def test_la_api_dice_de_donde_sale_el_navegador(cliente):
    datos = cliente.get("/api/browser/check").json()
    assert set(datos) == {"found", "origen", "exe", "apto", "detalle"}
    if datos["found"]:
        assert datos["origen"] in ("app", "sistema")


@pytest.mark.parametrize("ini,esperado", [(INI_ESR, True), (INI_RELEASE, False)])
def test_open_bloquea_un_navegador_no_apto(cliente, runtime_limpio, tmp_path, monkeypatch, ini, esperado):
    """Si el binario no sirve, NO se abre a medias: se explica y se para.

    Abrir con un release dejaría la identidad corriendo sin Collector, que es peor que no abrir.
    """
    exe = _falso_firefox(tmp_path / f"bin-{esperado}", ini)
    perfil = runtime_limpio.profiles / "alias_uno" / "profile"
    perfil.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr("app.core.profile_manager.ProfileManager.base_exe", lambda self: exe)
    lanzados = []
    monkeypatch.setattr("app.api.profiles.subprocess.Popen",
                        lambda *a, **k: lanzados.append(a) or object())

    r = cliente.post("/api/profiles/alias_uno/open", json={})
    if esperado:
        assert r.status_code == 200, r.text
        assert lanzados, "Con un ESR válido tiene que lanzar el navegador"
    else:
        assert r.status_code == 409, r.text
        assert not lanzados, "Con un release NO puede lanzar nada"
