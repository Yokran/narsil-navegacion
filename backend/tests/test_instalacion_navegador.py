"""El stream de instalación del navegador SIEMPRE termina diciendo algo.

La instalación es lo primero que hace un operador que estrena el equipo, y se sigue por un
stream de eventos. Si el hilo que instala revienta por algo que `install_firefox` no previó
—disco lleno al mover el navegador a su sitio, un permiso—, el stream se cerraba sin un solo
evento: la interfaz se quedaba con la última barra de progreso pintada y ni un motivo. El
operador sólo ve que «no hace nada».
"""
from __future__ import annotations

import json

from app.core import firefox


def _eventos(texto: str) -> list[dict]:
    return [json.loads(linea[6:]) for linea in texto.splitlines() if linea.startswith("data: ")]


def test_el_stream_termina_en_done_aunque_reviente_la_instalacion(cliente, monkeypatch):
    def revienta(base_dir, emit):
        emit("progress", pct=30, message="Descargando Firefox ESR...")
        raise OSError("No space left on device")

    monkeypatch.setattr(firefox, "install_firefox", revienta)

    r = cliente.post("/api/profiles/browser/install")
    assert r.status_code == 200
    eventos = _eventos(r.text)
    assert eventos, "el stream no ha emitido nada"
    final = eventos[-1]
    assert final["type"] == "done"
    assert final["ok"] is False
    assert "No space left on device" in final["message"]


def test_el_stream_deja_pasar_el_progreso_y_el_final_bueno(cliente, monkeypatch):
    def instala(base_dir, emit):
        emit("progress", pct=10, message="Descargando Firefox ESR...")
        emit("progress", pct=70, message="Extrayendo Firefox ESR...")
        emit("done", ok=True, message="Firefox ESR instalado. ¡Listo para operar!")

    monkeypatch.setattr(firefox, "install_firefox", instala)

    eventos = _eventos(cliente.post("/api/profiles/browser/install").text)
    assert [e["type"] for e in eventos] == ["progress", "progress", "done"]
    assert eventos[-1]["ok"] is True
    assert [e["pct"] for e in eventos if e["type"] == "progress"] == [10, 70]


def test_una_plataforma_sin_soporte_se_explica(monkeypatch, tmp_path):
    """macOS no tiene instalación automática: tiene que decirlo, no callarse."""
    monkeypatch.setattr(firefox, "plataforma", lambda: "macos-arm64")
    emitidos: list[tuple] = []
    firefox.install_firefox(tmp_path, lambda tipo, **kw: emitidos.append((tipo, kw)))
    tipo, datos = emitidos[-1]
    assert tipo == "done" and datos["ok"] is False
    assert "macos-arm64" in datos["message"]
