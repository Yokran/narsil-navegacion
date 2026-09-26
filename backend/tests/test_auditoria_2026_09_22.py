"""Lo que dejó la auditoría del 22-sep-2026 (H4, H5, H7, H12): ficheros privados, enlace
validado, tope de URL y nombres estrictos."""
from __future__ import annotations

import os
import stat

import pytest

from app import ajustes
from app.core.profile_manager import is_valid_profile_name


@pytest.mark.parametrize("nombre", ["victima\n", "CON", "nul", "COM1", "Lpt9", "con.txt"])
def test_nombres_con_salto_final_o_reservados_de_windows_no_valen(nombre):
    assert is_valid_profile_name(nombre) is False


@pytest.mark.parametrize("nombre", ["Prueba", "Lucía 2", "consuelo", "conde.perfil"])
def test_nombres_normales_siguen_valiendo(nombre):
    assert is_valid_profile_name(nombre) is True


@pytest.mark.skipif(os.name == "nt", reason="permisos POSIX")
def test_el_fichero_del_nodo_nace_privado(tmp_path, monkeypatch):
    from app.paths import AppPaths
    monkeypatch.setattr(ajustes, "_ruta", lambda p: tmp_path / "app.json")
    paths = AppPaths()
    monkeypatch.setattr(type(paths), "settings_dir", property(lambda self: tmp_path))
    ajustes.guardar_url_nodo(paths, "http://nodo.prueba:7420")
    assert stat.S_IMODE((tmp_path / "app.json").stat().st_mode) == 0o600


def test_la_url_del_nodo_tiene_tope():
    with pytest.raises(ajustes.UrlInvalida):
        ajustes.validar_url_nodo("http://x/" + "a" * 3000)


@pytest.mark.skipif(os.name == "nt", reason="permisos POSIX")
def test_las_credenciales_del_perfil_nacen_privadas(cliente, datos):
    (datos / "profiles" / "Privada").mkdir(parents=True, exist_ok=True)
    r = cliente.post("/api/profiles/Privada/meta", json={"category": "", "description": "", "notes": "",
                                                          "credentials": "usuario:clave", "services": []})
    assert r.status_code == 200
    fichero = datos / "profiles" / "Privada" / "narsil_meta.json"
    assert stat.S_IMODE(fichero.stat().st_mode) == 0o600


def test_el_enlace_comercial_invalido_no_llega_al_navegador(cliente, monkeypatch):
    from app.api import system
    abiertas: list[str] = []
    monkeypatch.setattr(system.webbrowser, "open", lambda u: abiertas.append(u) or True)
    monkeypatch.setattr(system, "ENLACE_ACCESO", "file:///etc/passwd")
    r = cliente.post("/api/enlace/acceso")
    assert r.status_code == 500 and abiertas == []
