"""Punto de entrada del ejecutable (y del arranque de escritorio desde el código).

    python narsil_navegacion.py                # ventana propia (o el navegador si no hay motor)
    python narsil_navegacion.py --sin-ventana  # solo el servidor local
"""
from __future__ import annotations

import sys

from app.lanzador import main

if __name__ == "__main__":
    sys.exit(main())
