# Setting Up the Loops

What a machine needs before `tools/loop` will run. See [README.md](README.md) for
what the loops do.

## Linux

Verified on Ubuntu 24.04, on x86-64 (the cloud container this was built in) and on
ARM64 (under WSL2, below).

```bash
# System packages. mesa-vulkan-drivers is only needed on a machine with no GPU.
sudo apt-get install -y ffmpeg build-essential git mesa-vulkan-drivers \
  python3-venv python3-pip python3-numpy pkg-config curl

# Rust (https://rustup.rs). Python 3.10 or later with numpy is installed above.
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal

# The rendering engine
(cd packages/visualiser && cargo build --release)

# The instrumented module player (about a minute; fetches and patches OpenMPT)
tools/loop/modplayer/build.sh

# The module corpus listed in tools/loop/corpus/manifest.json (about 60 MB; it waits a
# second between downloads, so about twelve minutes)
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

`run.py` exits non-zero when a clip fails a hard gate. Until the feedback-first
rendering work lands, most of the example scenes do (frozen, or blown out to white),
so a non-zero exit there is the scenes, not the setup. The setup is right if every
clip renders and `run.py` with no arguments reports no changes against the saved
baseline.

The first full `accuracy.py` run renders every module in the corpus; later runs reuse
the cache in `.loop/`. `--jobs` sets how many modules are analysed at once (default 4);
use about two thirds of the machine's cores.

### GPU

- **Models** use the GPU when PyTorch can: `tools/loop/models/setup.sh` installs the
  CUDA build of PyTorch if `nvidia-smi` works and the CPU build otherwise
  (`TORCH_INDEX=cpu` forces the latter). Set `OCTOSEQ_DEVICE=cpu` to keep a run off
  the GPU.
- **Rendering** uses whatever Vulkan device the engine finds. With a GPU and its
  driver that is the GPU; with only `mesa-vulkan-drivers` it is the CPU.

## Windows

Verified on Windows 11 on ARM64 with an NVIDIA GPU (November 2026). **Use WSL2 with
Ubuntu 24.04, plus one extra step so rendering reaches the GPU.**

Why WSL2 and not native Windows:

- Everything in the Linux section works there unchanged, including the module
  player's build.
- PyTorch has no CUDA build for Windows on ARM64, only a CPU one. It does for Linux
  on ARM64, and WSL2 passes the GPU through to CUDA. So WSL2 is the only way to run
  the models on this machine's GPU. (On an x86-64 Windows machine PyTorch does have
  a native CUDA build, but the native route below is still unfinished.)

The one thing WSL2 lacks is a Vulkan driver for the GPU: Ubuntu 24.04's Mesa offers
only the CPU renderer there. That is fixed by building the engine a second time as a
Windows program and letting the loop run that (see "Rendering on the GPU" below).

### Setup

In PowerShell:

```powershell
wsl --install Ubuntu-24.04
```

Then, inside Ubuntu, clone the repository **into the Linux filesystem** (for example
`~/code/octoseq`), not under `/mnt/c`: builds and the cache are several times slower
across the Windows boundary, and a Windows checkout has Windows line endings, which
break the shell scripts. Follow the Linux section from there.

If the repository is already checked out on Windows, clone from that copy and commit
from the WSL one:

```bash
git config --global --add safe.directory /mnt/c/Users/<you>/code/octoseq/.git
git clone /mnt/c/Users/<you>/code/octoseq ~/code/octoseq
```

API keys in a `.env` file at the root of the Windows checkout need copying across
(`cp /mnt/c/Users/<you>/code/octoseq/.env ~/code/octoseq/.env`); the file is ignored
by git.

### Rendering on the GPU

Install Rust on the Windows side once (PowerShell), with the Visual Studio C++ build
tools it asks for:

```powershell
winget install Rustlang.Rustup
```

Then, in WSL:

```bash
tools/loop/win-engine.sh        # builds the engine for Windows; prints an export line
echo "export OCTOSEQ_ENGINE='/mnt/c/Users/<you>/AppData/Local/octoseq/visualiser/target/release/visualiser.exe'" >> ~/.profile
```

`tools/loop/run.py` renders with whatever `OCTOSEQ_ENGINE` names, translating paths
for a Windows program. Run `win-engine.sh` again after changing the engine: it copies
the source across and rebuilds. Unset the variable to render inside WSL on the CPU.

Measured on the machine above (NVIDIA RTX GPU, 18 cores), five seconds of one scene:

| Engine                        | 480x270 | 1920x1080 |
| ----------------------------- | ------- | --------- |
| Built in WSL, CPU rendering   | 43 fps  | 4.5 fps   |
| Built for Windows, on the GPU | 58 fps  | 12 fps    |

At the loop's small size both are limited by writing PNG files, so the GPU matters
most for full-resolution clips. GPU and CPU frames differ slightly: the same scene
gives metrics within about 0.02 of each other, and the same pass or fail on every
clip. Each is deterministic on its own. The saved baseline was recorded with CPU
rendering.

### Native Windows

Not finished, and not needed. What is known:

- The engine builds with the MSVC Rust toolchain and renders on the GPU through
  Vulkan (that is the build `win-engine.sh` makes).
- The Python tools add `.exe` where needed but have not been run under Windows
  Python.
- The module player's build script needs `bash`, `make` and `g++` (MSYS2 provides
  them) and has not been tried.
- On ARM64, PyTorch would run on the CPU only.

## API keys

Read from the environment, then from a `.env` file at the root of the repository
(ignored by git). Never commit them or paste them into a chat. The tools never print
them and scrub them from error messages.

| Variable                 | Service    | Used for                                                    |
| ------------------------ | ---------- | ----------------------------------------------------------- |
| `LALALAI_API_KEY`        | LALAL.AI   | Stem separation                                             |
| `MUSICAI_API_KEY`        | Music.ai   | Stem separation; beats, chords, sections                    |
| `MUSICAI_STEMS_WORKFLOW` | Music.ai   | The slug of a stem-separation workflow made in your account |
| `FAL_KEY`                | fal.ai     | Stem separation with hosted Demucs                          |
| `ANTHROPIC_API_KEY`      | Claude API | The prompted director (milestone 3)                         |

`python3 tools/loop/stems.py status` says which stem sources can run. The hosted ones
cost money each time they separate a new file. Results are cached in `.loop/`, and
what each scored is recorded in `tools/loop/hosted_stem_scores.json`, so the accuracy
loop does not pay twice and still reports them on a machine with no keys.
