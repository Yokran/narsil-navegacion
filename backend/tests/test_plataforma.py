"""Detección de sistema y arquitectura.

De esto depende de dónde sale el navegador: Mozilla no publica ESR para ARM64 (ahí el binario
viene del snap de Canonical), el instalador de Windows es NSIS y no tarball, y en Windows sobre
ARM el paquete es otro distinto, no el de x86-64 emulado. Equivocarse aquí no da un error
claro: da una descarga que no arranca.
"""
from __future__ import annotations

import pytest

from app.core import firefox

CONOCIDAS = {"windows-x86_64", "windows-arm64", "macos-arm64", "macos-x86_64",
             "linux-aarch64", "linux-x86_64"}


def test_status_devuelve_la_plataforma(cliente):
    datos = cliente.get("/api/status").json()
    assert datos["status"] == "online"
    assert datos["platform"] in CONOCIDAS
    assert datos["platform"] == firefox.plataforma()


def test_esta_maquina_es_linux_arm64():
    """La máquina de desarrollo es aarch64. Si esto cambia, hay que revisar la rama del snap."""
    import platform as plat
    if plat.system().lower() != "linux" or plat.machine().lower() not in ("aarch64", "arm64"):
        pytest.skip("Sólo aplica en el Linux ARM64 de desarrollo")
    assert firefox.plataforma() == "linux-aarch64"


@pytest.mark.parametrize("sistema,maquina,esperado", [
    ("Windows", "AMD64",   "windows-x86_64"),
    ("Windows", "ARM64",   "windows-arm64"),
    ("Linux",   "x86_64",  "linux-x86_64"),
    ("Linux",   "aarch64", "linux-aarch64"),
    ("Linux",   "arm64",   "linux-aarch64"),
    ("Darwin",  "arm64",   "macos-arm64"),
    ("Darwin",  "x86_64",  "macos-x86_64"),
])
def test_mapa_de_plataformas(monkeypatch, sistema, maquina, esperado):
    monkeypatch.setattr(firefox.platform, "system", lambda: sistema)
    monkeypatch.setattr(firefox.platform, "machine", lambda: maquina)
    assert firefox.plataforma() == esperado


def test_windows_arm64_pide_el_paquete_correcto(monkeypatch):
    """`win64-aarch64`, no `win64`. El segundo correría emulado, si arranca."""
    monkeypatch.setattr(firefox.platform, "system", lambda: "Windows")
    monkeypatch.setattr(firefox.platform, "machine", lambda: "ARM64")

    pedidos = []
    monkeypatch.setattr(firefox, "_instalar_windows",
                        lambda base, emit, *, arco="win64": pedidos.append(arco))
    firefox.install_firefox(base_dir=None, emit=lambda *a, **k: None)
    assert pedidos == ["win64-aarch64"]


def test_linux_arm64_no_usa_el_tarball(monkeypatch):
    """Mozilla no publica tarball ESR para ARM64: si se pidiera, no habría nada que bajar."""
    monkeypatch.setattr(firefox.platform, "system", lambda: "Linux")
    monkeypatch.setattr(firefox.platform, "machine", lambda: "aarch64")

    llamadas = []
    monkeypatch.setattr(firefox, "_instalar_linux_tarball",
                        lambda *a, **k: llamadas.append("tarball"))
    monkeypatch.setattr(firefox, "_instalar_linux_arm64",
                        lambda *a, **k: llamadas.append("snap"))
    firefox.install_firefox(base_dir=None, emit=lambda *a, **k: None)
    assert llamadas == ["snap"]
