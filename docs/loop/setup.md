# Setting Up the Loops

What a machine needs before `tools/loop` will run. See [README.md](README.md) for
what the loops do.

## Linux

Verified on Ubuntu 24.04 (the cloud container this was built in).

```bash
# System packages. mesa-vulkan-drivers is only needed on a machine with no GPU.
sudo apt-get install -y ffmpeg build-essential git mesa-vulkan-drivers

# Rust (https://rustup.rs) and Python 3.10 or later with numpy
pip install numpy

# The rendering engine
(cd packages/visualiser && cargo build --release)

# The instrumented module player (about five minutes; fetches and patches OpenMPT)
tools/loop/modplayer/build.sh

# The module corpus listed in tools/loop/corpus/manifest.json (about 60 MB)
python3 tools/loop/corpus.py restore

# Optional: model-based analysers, into .loop/venv
tools/loop/models/setup.sh
```

Check it:

```bash
python3 tools/loop/selftest.py           # the render loop's instruments
python3 tools/loop/accuracy.py --quick   # the accuracy loop on the committed fixtures, ~20 s
python3 tools/loop/run.py --seconds 5    # every scene on every test track, briefly
```

The first full `accuracy.py` run renders every module in the corpus and takes ten to
fifteen minutes; later runs reuse the cache in `.loop/` and take about six. With the
model analysers included, allow half an hour.

## Windows

**Not yet verified on a Windows machine.** The loops were built and run only on
Linux. Two routes:

- **WSL2 with Ubuntu (recommended).** Everything above applies unchanged, including
  software rendering through `mesa-vulkan-drivers`. Keep the repository inside the
  WSL filesystem, not under `/mnt/c`, or the builds and the cache will be slow.
- **Native Windows.** The render loop should need only Rust (MSVC toolchain), Python
  with numpy, and `ffmpeg` on `PATH`; the engine uses the machine's own GPU through
  DirectX 12 or Vulkan, with no extra driver. The accuracy loop also needs the module
  player, and its build script needs `bash`, `make` and `g++` (MSYS2 provides them).
  The Python tools avoid Linux-only commands and add `.exe` where needed, but none of
  this has been run on Windows.

## API keys

None is needed for anything that exists today. The adaptors that will use them are
not built yet; these are the names they will read, so the keys can be set once:

| Variable            | Service    | Used for                                 |
| ------------------- | ---------- | ---------------------------------------- |
| `LALALAI_API_KEY`   | LALAL.AI   | Stem separation                          |
| `MUSICAI_API_KEY`   | Music.ai   | Stem separation; beats, chords, sections |
| `FAL_KEY`           | fal.ai     | Stem separation with hosted Demucs       |
| `ANTHROPIC_API_KEY` | Claude API | The prompted director (milestone 3)      |

Set them as environment variables on the machine that runs the loops. Never commit
them or paste them into a chat.
