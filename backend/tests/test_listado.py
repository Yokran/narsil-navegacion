"""El listado de identidades: qué cuesta y qué dice.

La interfaz pide este listado cada cuatro segundos. Preguntar «¿está abierta?» identidad por
identidad significaba un barrido completo de la tabla de procesos por cada una: con las cuarenta
identidades de las que habla el propio README, cuarenta barridos cada cuatro segundos en el
equipo del operador. Se mide lo que importa —el número de barridos— y no el tiempo, que depende
de la máquina.
"""
from __future__ import annotations

import psutil

from app.core.profile_manager import ProfileManager


def _crear_identidades(runtime_limpio, cuantas: int) -> list[str]:
    nombres = []
    for i in range(cuantas):
        nombre = f"identidad_{i}"
        (runtime_limpio.profiles / nombre / "profile").mkdir(parents=True, exist_ok=True)
        nombres.append(nombre)
    return nombres


def test_el_listado_barre_los_procesos_una_sola_vez(cliente, runtime_limpio, monkeypatch):
    _crear_identidades(runtime_limpio, 8)

    barridos = {"n": 0}
    original = psutil.process_iter

    def contando(*args, **kwargs):
        barridos["n"] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(psutil, "process_iter", contando)

    r = cliente.get("/api/profiles")
    assert r.status_code == 200
    assert len(r.json()) == 8
    assert barridos["n"] == 1, f"8 identidades y {barridos['n']} barridos de procesos"


def test_sin_identidades_no_se_barre_nada(cliente, runtime_limpio, monkeypatch):
    barridos = {"n": 0}
    monkeypatch.setattr(psutil, "process_iter",
                        lambda *a, **k: barridos.__setitem__("n", barridos["n"] + 1) or iter(()))
    assert cliente.get("/api/profiles").json() == []
    assert barridos["n"] == 0


class _ProcesoFalso:
    def __init__(self, pid: int, name: str, cmdline: list[str]) -> None:
        self.info = {"pid": pid, "name": name, "cmdline": cmdline}


def test_reconoce_la_identidad_abierta_y_solo_esa(runtime_limpio, monkeypatch, tmp_path):
    """Lo que distingue a una identidad de otra es su carpeta, no que haya un Firefox vivo.

    De confundir las dos cosas salió el incidente en el que cerrar un perfil mandaba la señal al
    proceso equivocado.
    """
    pm = ProfileManager(profiles_dir=tmp_path / "profiles",
                        base_browser_dir=tmp_path / "bb",
                        templates_dir=tmp_path / "t")
    for nombre in ("alias_uno", "alias_dos"):
        (pm.profiles_dir / nombre / "profile").mkdir(parents=True, exist_ok=True)

    abierta = str(pm.profile_data_dir("alias_uno").resolve())
    monkeypatch.setattr(psutil, "process_iter", lambda *a, **k: iter([
        _ProcesoFalso(10, "firefox", ["/opt/firefox/firefox", "-profile", abierta, "-no-remote"]),
        _ProcesoFalso(11, "firefox", ["/opt/firefox/firefox", "-profile", "/otro/sitio/profile"]),
        _ProcesoFalso(12, "bash", ["bash", "-c", "algo"]),
        _ProcesoFalso(13, "zombi", []),
    ]))

    assert pm.perfiles_en_ejecucion(["alias_uno", "alias_dos"]) == {"alias_uno"}


def test_el_listado_marca_como_activa_la_identidad_abierta(cliente, runtime_limpio, monkeypatch):
    from app.context import pm

    _crear_identidades(runtime_limpio, 3)
    abierta = str(pm.profile_data_dir("identidad_1").resolve())
    monkeypatch.setattr(psutil, "process_iter", lambda *a, **k: iter([
        _ProcesoFalso(20, "firefox", ["/opt/firefox/firefox", "-profile", abierta]),
    ]))

    activos = {p["name"]: p["running"] for p in cliente.get("/api/profiles").json()}
    assert activos == {"identidad_0": False, "identidad_1": True, "identidad_2": False}
