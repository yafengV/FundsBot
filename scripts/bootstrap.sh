#!/usr/bin/env bash
set -euo pipefail

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

ensure_brew_pkg() {
  local pkg="$1"
  if ! brew list "$pkg" >/dev/null 2>&1; then
    echo "[bootstrap] installing $pkg ..."
    brew install "$pkg"
  else
    echo "[bootstrap] $pkg already installed"
  fi
}

if ! need_cmd brew; then
  echo "[bootstrap] Homebrew not found. Please install Homebrew first." >&2
  exit 1
fi

ensure_brew_pkg jq
ensure_brew_pkg yq
ensure_brew_pkg openapi-generator

# Spectral (OpenAPI lint)
if ! need_cmd spectral; then
  echo "[bootstrap] installing spectral..."
  npm i -g @stoplight/spectral-cli
else
  echo "[bootstrap] spectral already installed"
fi

echo "[bootstrap] done"
