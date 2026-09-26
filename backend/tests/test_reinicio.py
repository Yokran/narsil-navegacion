"""Si el operador reabre la app antes de que la anterior haya soltado el puerto, se espera."""
from __future__ import annotations

import socket
import threading
import time

from app import ciclo, lanzador


def test_el_puerto_ocupado_se_espera_y_se_coge_cuando_se_libera():
    ocupante = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ocupante.bind(("127.0.0.1", 0))
    puerto = ocupante.getsockname()[1]
    assert lanzador.puerto_libre("127.0.0.1", puerto) is False
    threading.Timer(0.6, ocupante.close).start()
    t0 = time.monotonic()
    assert lanzador.esperar_puerto_libre(5.0, "127.0.0.1", puerto) is True
    assert 0.4 < time.monotonic() - t0 < 4.0


def test_si_el_puerto_no_se_libera_se_rinde_con_false():
    ocupante = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ocupante.bind(("127.0.0.1", 0))
    try:
        assert lanzador.esperar_puerto_libre(0.6, "127.0.0.1", ocupante.getsockname()[1]) is False
    finally:
        ocupante.close()
