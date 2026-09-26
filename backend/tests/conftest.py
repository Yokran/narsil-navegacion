"""Arranque de las pruebas.

Todo lo que sigue se ejecuta ANTES de importar la app, porque `paths.py` resuelve el
directorio de datos al importarse. Si se hiciera después, las pruebas escribirían en los
perfiles reales del operador — que es justo el accidente que estas pruebas existen para evitar.

Las pruebas no tocan la red ni abren Firefox. Las que lo necesitarían van marcadas `navegador`
y están desactivadas por omisión.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_BACKEND))

DATOS_PRUEBA = Path(tempfile.mkdtemp(prefix="narsil-nav-pruebas-"))
os.environ["NAV_DATA_DIR"] = str(DATOS_PRUEBA)
os.environ["NARSIL_NODE_URL"] = ""          # se parte de «modo autónomo», sin herencias
os.environ["NARSIL_BROWSER_GFX"] = "x11"

import pytest                                      # noqa: E402
from fastapi.testclient import TestClient          # noqa: E402

from app.context import runtime_paths              # noqa: E402
from app.main import app as aplicacion             # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "navegador: necesita un Firefox real (no se lanza solo)")


@pytest.fixture(scope="session")
def datos() -> Path:
    return DATOS_PRUEBA


@pytest.fixture()
def cliente() -> TestClient:
    """Cliente contra la app REAL: mismas rutas, mismas dependencias, mismo router.

    Nada de probar los validadores por separado: el agujero del preview no estaba en la función
    de validar, estaba en las rutas que no la llamaban.

    `base_url` con la dirección de verdad y no el `testserver` de fábrica: el guardia local
    comprueba la cabecera `Host`, y un cliente que dice venir de otro sitio se rechaza — que es
    justo lo que se quiere que le pase a un DNS rebinding.
    """
    with TestClient(aplicacion, base_url="http://127.0.0.1:8420") as c:
        yield c


@pytest.fixture()
def runtime_limpio():
    """Runtime mínimo y verificable: una plantilla, una extensión de mentira, nada más.

    Sirve de canario de la jaula de rutas: si una petición hostil escapa de `profiles/`, lo que
    se lleva por delante es esto, y la prueba lo nota.
    """
    for d in (runtime_paths.templates_dir, runtime_paths.extensions_dir,
              runtime_paths.profiles, runtime_paths.settings_dir):
        d.mkdir(parents=True, exist_ok=True)

    base = runtime_paths.templates_dir / "narsil-base"
    base.mkdir(parents=True, exist_ok=True)
    (base / "user.js").write_text("// plantilla base\n", encoding="utf-8")

    ext = runtime_paths.extensions_dir / "narsil-intel@narsil.local"
    ext.mkdir(parents=True, exist_ok=True)
    (ext / "manifest.json").write_text(
        '{"manifest_version": 2, "name": "NARSIL Intelligence Collector", "version": "1.0.1",'
        ' "browser_specific_settings": {"gecko": {"id": "narsil-intel@narsil.local"}}}\n',
        encoding="utf-8")

    yield runtime_paths

    shutil.rmtree(runtime_paths.profiles, ignore_errors=True)
    runtime_paths.profiles.mkdir(parents=True, exist_ok=True)
