#!/usr/bin/env bash
# Build the instrumented module player used by the analysis-accuracy loop.
#
#   tools/loop/modplayer/build.sh
#
# Fetches OpenMPT at a pinned commit, applies openmpt-eventlog.patch, builds
# libopenmpt as a static library and links modrender against it. The result is
# .loop/bin/modrender. Everything is built in the git-ignored .loop/ directory:
# this is a development tool for the loop, not a dependency of Octoseq itself.
#
# The pinned commit is the upstream baseline ScreamSeq compares its engine
# against (see UPSTREAM.md in rewbs/ScreamSeq), so reference timing matches the
# playback engine ScreamSeq is built on.
#
# Set OPENMPT_SRC to reuse an existing checkout of that commit.
set -euo pipefail

OPENMPT_COMMIT=f83cedb0cd5446e4dfaa83ac97e3087107e26767
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SRC="${OPENMPT_SRC:-$ROOT/.loop/cache/openmpt}"
BIN="$ROOT/.loop/bin"

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$SRC"
  git -C "$SRC" init -q
  git -C "$SRC" remote add origin https://github.com/OpenMPT/openmpt
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$OPENMPT_COMMIT" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git -C "$SRC" fetch -q --depth 1 origin "$OPENMPT_COMMIT"
  git -C "$SRC" checkout -q FETCH_HEAD
fi

# Apply the instrumentation unless it is already there.
if [ ! -f "$SRC/soundlib/OctoseqHook.h" ]; then
  git -C "$SRC" apply "$HERE/openmpt-eventlog.patch"
fi

make -C "$SRC" -j"$(nproc)" STATIC_LIB=1 SHARED_LIB=0 EXAMPLES=0 OPENMPT123=0 TEST=0 \
  NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1 NO_PORTAUDIO=1 \
  NO_PORTAUDIOCPP=1 NO_PULSEAUDIO=1 NO_SDL2=1 NO_FLAC=1 NO_SNDFILE=1 >/dev/null

mkdir -p "$BIN"
g++ -std=c++20 -O2 -I"$SRC" -o "$BIN/modrender" "$HERE/modrender.cpp" "$SRC/bin/libopenmpt.a" -lpthread
echo "built $BIN/modrender (OpenMPT $OPENMPT_COMMIT + openmpt-eventlog.patch)"
