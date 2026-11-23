#!/usr/bin/env bash
# Build projectM and the loop's offline renderer for it (pm_render).
#
#   tools/loop/projectm/build.sh [path to a projectM checkout]
#
# projectM (https://github.com/projectM-visualizer/projectm, LGPL 2.1) is not part
# of this repository. Point this at a checkout that has its submodule
# (git submodule update --init); the default is ~/code/projectm. Nothing in the
# checkout's source is changed: the build goes to .loop/projectm/.
#
# Needs: cmake, a C++ compiler, and OpenGL and EGL headers
#   sudo apt-get install -y cmake libegl-dev libgl-dev libgles-dev
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
source="${1:-$HOME/code/projectm}"
out="$root/.loop/projectm"

if [ ! -f "$source/vendor/projectm-eval/CMakeLists.txt" ]; then
  echo "no projectM checkout with its submodule at $source" >&2
  echo "  git clone --recurse-submodules https://github.com/projectM-visualizer/projectm $source" >&2
  exit 1
fi

mkdir -p "$out/build"
cmake -S "$source" -B "$out/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$out/install" \
  -DENABLE_SYSTEM_PROJECTM_EVAL=OFF -DENABLE_PLAYLIST=OFF -DBUILD_SHARED_LIBS=ON -DENABLE_INSTALL=ON >"$out/cmake.log" 2>&1 \
  || { tail -20 "$out/cmake.log" >&2; exit 1; }
cmake --build "$out/build" -j "$(nproc)" >"$out/build.log" 2>&1 || { tail -30 "$out/build.log" >&2; exit 1; }
cmake --install "$out/build" >"$out/install.log" 2>&1 || { tail -20 "$out/install.log" >&2; exit 1; }

libdir="$(dirname "$(find "$out/install" -name 'libprojectM-4.so*' | head -1)")"
g++ -O2 -std=c++17 "$here/pm_render.cpp" -I"$out/install/include" -L"$libdir" -Wl,-rpath,"$libdir" \
  -lprojectM-4 -lEGL -lGL -o "$out/pm_render"
echo "built $out/pm_render"
