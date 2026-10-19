#!/usr/bin/env bash
# Local start: ./run.sh   (needs Python 3.10+ and ffmpeg)
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] && set -a && . ./.env && set +a
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
