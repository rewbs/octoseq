#!/usr/bin/env bash
# Set up the optional environment for model-based analysers (tools/loop/analysers.py).
#
#   tools/loop/models/setup.sh
#   .loop/venv/bin/python tools/loop/accuracy.py     # the loop, with the models included
#
# Everything goes into the git-ignored .loop/venv. The system Python is left alone,
# and running the loop with it simply leaves the model analysers out.
#
# PyTorch is installed with CUDA support when an NVIDIA GPU is visible (nvidia-smi
# works), and as the much smaller CPU build otherwise. Override with
# TORCH_INDEX=cpu or TORCH_INDEX=cu130 (any index name under
# https://download.pytorch.org/whl/).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
VENV="$ROOT/.loop/venv"
# torchaudio stopped at 2.11.0, and each torchaudio works with exactly one torch.
TORCH_VERSION=2.11.0

if [ -z "${TORCH_INDEX:-}" ]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    TORCH_INDEX=cu130
  else
    TORCH_INDEX=cpu
  fi
fi
echo "installing torch $TORCH_VERSION from the $TORCH_INDEX index"

python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/pip" install --quiet --index-url "https://download.pytorch.org/whl/$TORCH_INDEX" \
  "torch==$TORCH_VERSION" "torchaudio==$TORCH_VERSION"
"$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
"$VENV/bin/python" - <<EOF
import sys
sys.path.insert(0, "$ROOT/tools/loop")
import torch
import analysers
print("torch", torch.__version__, "- device:", analysers.model_device())
print("model analysers available:", sorted(analysers.MODELS))
EOF
