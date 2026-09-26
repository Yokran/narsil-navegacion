"""Ganchos del ciclo de vida que la API necesita y solo el lanzador conoce.

`antes_de_cerrar` lo registra el lanzador: cierra las ventanas y para el servidor local (y
con él suelta el puerto) antes de que la app salga por orden del actualizador.
"""
from __future__ import annotations

from typing import Callable

antes_de_cerrar: Callable[[], None] | None = None


def preparar_relanzamiento() -> None:
    """Nombre histórico; hoy significa «suelta todo antes de salir»."""
    fn = antes_de_cerrar
    if fn is not None:
        try:
            fn()
        except Exception:
            pass
