#!/usr/bin/env bash
# Build the engine natively for Windows, from WSL, so the render loop can use the GPU.
#
#   tools/loop/win-engine.sh
#   export OCTOSEQ_ENGINE=...        # the line it prints; put it in ~/.profile
#
# WSL has no Vulkan driver for the GPU, so an engine built inside WSL renders on the
# CPU. A Windows build of the same source renders on the GPU, and WSL can run it
# directly; tools/loop/run.py uses it when OCTOSEQ_ENGINE points at it.
#
# The engine source is copied to a folder on the Windows side and built there with
# the Windows Rust toolchain (install it once: winget install Rustlang.Rustup, plus
# the Visual Studio C++ build tools). Run this again after changing the engine.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CMD=/mnt/c/Windows/System32/cmd.exe

if [ ! -x "$CMD" ]; then
  echo "this script is for WSL: on Linux the engine built by cargo already uses the GPU" >&2
  exit 1
fi
win_env() { (cd /mnt/c && "$CMD" /c "echo %$1%" 2>/dev/null </dev/null | tr -d '\r'); }

CARGO="$(wslpath -u "$(win_env USERPROFILE)")/.cargo/bin/cargo.exe"
if [ ! -x "$CARGO" ]; then
  echo "Rust is not installed on Windows. In PowerShell: winget install Rustlang.Rustup" >&2
  exit 1
fi

BUILD="$(wslpath -u "$(win_env LOCALAPPDATA)")/octoseq/visualiser"
mkdir -p "$BUILD"
# Copy the source, leaving build output alone on both sides.
(cd "$ROOT/packages/visualiser" && tar --exclude=./target --exclude=./frames -cf - .) | (cd "$BUILD" && tar -xf -)
(cd "$BUILD" && "$CARGO" build --release --quiet </dev/null)

echo "built $BUILD/target/release/visualiser.exe" >&2
echo "export OCTOSEQ_ENGINE='$BUILD/target/release/visualiser.exe'"
