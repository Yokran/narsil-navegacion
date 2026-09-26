"""El runtime (extensión, plantilla) habla con ESTA app, nunca con el puerto del nodo.

Venía del preview apuntando a 127.0.0.1:7420 (donde entonces vivía la plataforma): el badge de
identidad no reconocía la start page y, peor, lo que hoy ocupe ese puerto en el equipo del
operador recibiría URL y título de lo que ve cada identidad.
"""
from __future__ import annotations

import re
from pathlib import Path

from app.config import NARSIL_PORT

RUNTIME = Path(__file__).resolve().parents[1] / "data" / "runtime"


def _ficheros():
    for sub in ("extensions", "templates"):
        for p in (RUNTIME / sub).rglob("*"):
            if p.suffix in (".js", ".html", ".json", ".css"):
                yield p


def test_ningun_puerto_de_loopback_que_no_sea_el_de_esta_app():
    malos = []
    for p in _ficheros():
        for m in re.finditer(r"127\\?\.0\\?\.0\\?\.1:(\d+)", p.read_text(encoding="utf-8", errors="ignore")):
            if int(m.group(1)) != NARSIL_PORT:
                malos.append(f"{p.relative_to(RUNTIME)}:{m.group(0)}")
    assert not malos, malos


def test_la_start_page_usa_el_escudo_de_marca(cliente):
    r = cliente.get("/profile-start/Prueba")
    assert r.status_code == 200
    assert 'src="/marca/escudo.png"' in r.text
    assert "<svg" not in r.text
