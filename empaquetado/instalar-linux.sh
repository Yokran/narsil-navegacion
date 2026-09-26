#!/usr/bin/env bash
# Instala el ejecutable de NARSIL Navegación para el usuario actual (sin sudo): el binario y sus
# datos en ~/.local/share/NARSIL Navegacion, un enlace en ~/.local/bin y una entrada de menú con
# el escudo.
#
#   bash empaquetado/instalar-linux.sh [dist/narsil-navegacion-linux-<arquitectura>]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
BIN="${1:-dist/narsil-navegacion-linux-$(uname -m)}"
test -x "$BIN" || { echo "No existe $BIN: construye primero (bash empaquetado/construir.sh)"; exit 1; }

DESTINO="$HOME/.local/share/NARSIL Navegacion"
mkdir -p "$HOME/.local/bin" "$DESTINO/data" "$HOME/.local/share/applications" \
         "$HOME/.local/share/icons/hicolor/256x256/apps"

# El binario vive junto a sus datos (data/ al lado); en ~/.local/bin queda un enlace.
cp "$BIN" "$DESTINO/narsil-navegacion"
chmod 755 "$DESTINO/narsil-navegacion"
ln -sfn "$DESTINO/narsil-navegacion" "$HOME/.local/bin/narsil-navegacion"
cp empaquetado/narsil-256.png "$HOME/.local/share/icons/hicolor/256x256/apps/narsil-navegacion.png"

ENTRADA="$HOME/.local/share/applications/narsil-navegacion.desktop"
{
  echo "[Desktop Entry]"
  echo "Type=Application"
  echo "Name=NARSIL Navegación"
  echo "Comment=Identidades de navegación"
  echo "Exec=\"$DESTINO/narsil-navegacion\""
  echo "Icon=narsil-navegacion"
  echo "Terminal=false"
  echo "Categories=Network;Security;"
} > "$ENTRADA"

echo "INSTALADO $DESTINO/narsil-navegacion (datos en $DESTINO/data; entrada de menú: $ENTRADA)"
