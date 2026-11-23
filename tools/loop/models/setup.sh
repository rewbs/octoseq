#!/usr/bin/env bash
# Set up the optional environment for model-based analysers (tools/loop/analysers.py).
#
#   tools/loop/models/setup.sh
#   .loop/venv/bin/python tools/loop/accuracy.py     # the loop, with the models included
#
# Everything goes into the git-ignored .loop/venv. The system Python is left alone,
# and running the loop with it simply leaves the model analysers out.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
VENV="$ROOT/.loop/venv"

python3 -m venv --system-site-packages "$VENV"
# CPU builds: the loop has no GPU to give them, and they are a fraction of the size.
"$VENV/bin/pip" install --quiet --index-url https://download.pytorch.org/whl/cpu torch torchaudio
"$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
"$VENV/bin/python" -c "import sys; sys.path.insert(0, '$ROOT/tools/loop'); import analysers; print('model analysers available:', sorted(analysers.MODELS))"
