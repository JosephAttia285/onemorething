#!/bin/bash
cd "$(dirname "$0")"
source ~/miniconda3/etc/profile.d/conda.sh 2>/dev/null || source ~/anaconda3/etc/profile.d/conda.sh
conda activate omt
export HF_TOKEN=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
uvicorn server:app --port 8000
