#!/usr/bin/env bash
# NARSIL — Navegación :: arranque en Linux y macOS.
#
# La primera vez prepara el entorno; después arranca y abre la interfaz. El servicio escucha
# SOLO en 127.0.0.1: esta app no es un servicio de red, y quien la exponga expone el control de
# todas las identidades del operador.
set -e
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$raiz/backend"

if [ ! -x .venv/bin/python ]; then
  echo "  Primera vez: preparando el entorno (tarda un minuto)..."
  python3 -m venv .venv
  ./.venv/bin/pip install --upgrade pip -q
  ./.venv/bin/pip install -r requirements.txt -q
  # Ventana propia (opcional): con WebKitGTK del sistema; si no hay, se abre en el navegador.
  ./.venv/bin/pip install -q pywebview==6.2.1 || true
  echo "  Entorno listo."
fi

if [ ! -f "$raiz/ui/dist/index.html" ]; then
  echo "  AVISO: la interfaz no está compilada. Ejecuta:  cd ui && npm install && npm run build"
fi

echo "  Arrancando NARSIL Navegación (ventana propia si hay pywebview; si no, el navegador)."
echo "  Para parar: cierra la ventana o Ctrl+C."
exec ./.venv/bin/python narsil_navegacion.py "$@"
