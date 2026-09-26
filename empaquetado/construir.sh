#!/usr/bin/env bash
# Construye el ejecutable único de NARSIL Navegación en Linux, para la arquitectura de la
# máquina donde se ejecuta:
#   dist/narsil-navegacion-linux-x86_64    (en un Linux x86-64)
#   dist/narsil-navegacion-linux-aarch64   (en un Linux ARM64)
#
#   bash empaquetado/construir.sh
#
# Requiere Python 3.11+, la interfaz compilada en ui/dist y, para la ventana propia, WebKitGTK
# del sistema (Debian/Ubuntu: python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1). Sin ellos el
# ejecutable arranca igual y abre la interfaz en el navegador del sistema.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
RAIZ="$(pwd)"

test -f ui/dist/index.html || { echo "Falta ui/dist/index.html: compila la interfaz (cd ui && npm run build)"; exit 1; }

VENV=.venv-build
# --system-site-packages: PyGObject (gi) viene del sistema, no de pip.
[ -x "$VENV/bin/python" ] || python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/pip" install --disable-pip-version-check --quiet --upgrade pip
"$VENV/bin/pip" install --disable-pip-version-check --quiet -r backend/requirements.txt -r empaquetado/requirements-build.txt

# Un artefacto por sistema y arquitectura: narsil-navegacion-linux-x86_64 o -linux-aarch64.
NOMBRE="narsil-navegacion-linux-$(uname -m)"

rm -rf dist build
"$VENV/bin/python" -m PyInstaller --noconfirm --clean --onefile --windowed \
    --name "$NOMBRE" \
    --distpath dist --workpath build --specpath build \
    --paths "$RAIZ/backend" \
    --add-data "$RAIZ/ui/dist:ui" \
    --add-data "$RAIZ/backend/data/runtime/extensions:runtime/extensions" \
    --add-data "$RAIZ/backend/data/runtime/templates:runtime/templates" \
    --add-data "$RAIZ/empaquetado/narsil.ico:." \
    --add-data "$RAIZ/empaquetado/narsil-256.png:." \
    --collect-submodules app \
    --collect-all webview \
    --hidden-import gi.repository.Gtk \
    --hidden-import gi.repository.WebKit2 \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan.on \
    "$RAIZ/backend/narsil_navegacion.py"

ls -la "dist/$NOMBRE"
echo "CONSTRUIDO $(pwd)/dist/$NOMBRE"
