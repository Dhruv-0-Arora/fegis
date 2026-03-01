#!/usr/bin/env bash
# install-fegis.sh — Fegis Extension Installer for macOS/Linux
set -euo pipefail

ZIP_URL="https://cheesehacks26.vercel.app/downloads/fegis-extension.zip"

if [[ "$(uname)" == "Darwin" ]]; then
    INSTALL_DIR="$HOME/Library/Application Support/Fegis/extension"
    OPEN_CMD="open"
else
    INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/Fegis/extension"
    OPEN_CMD="xdg-open"
fi

TMP_ZIP="$(mktemp /tmp/fegis-extension.XXXXXX.zip)"

echo ""
echo "  Fegis Extension Installer"
echo ""

echo "[1/3] Downloading extension..."
curl -fsSL "$ZIP_URL" -o "$TMP_ZIP"

echo "[2/3] Extracting to $INSTALL_DIR..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
unzip -qo "$TMP_ZIP" -d "$INSTALL_DIR"
rm -f "$TMP_ZIP"

echo "[3/3] Opening Chrome extensions page..."
$OPEN_CMD "chrome://extensions" 2>/dev/null || true

echo ""
echo "  Almost done! In Chrome:"
echo "  1. Enable 'Developer mode' (top-right toggle)"
echo "  2. Click 'Load unpacked'"
echo "  3. Select: $INSTALL_DIR"
echo ""
