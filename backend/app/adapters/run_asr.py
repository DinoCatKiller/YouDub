"""
CLI wrapper for recognize_speech, callable from TypeScript via spawnSync.
Usage:
  .venv/bin/python backend/app/adapters/run_asr.py <vocals_wav> <session_path> <language>
Writes asr.json to session_path/metadata/ and prints the path on success.
"""
from __future__ import annotations

import sys
import os
from pathlib import Path

# Ensure backend/ is on sys.path so "from backend.app..." works
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from dotenv import load_dotenv
load_dotenv()

from backend.app.adapters.whisper_asr import recognize_speech


def main() -> None:
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <vocals_wav> <session_path> <language>", file=sys.stderr)
        sys.exit(1)

    vocals_file = Path(sys.argv[1])
    session_path = Path(sys.argv[2])
    language = sys.argv[3]

    if not vocals_file.is_file():
        print(f"Error: vocals file not found: {vocals_file}", file=sys.stderr)
        sys.exit(1)

    try:
        result = recognize_speech(vocals_file, session_path, language)
        print(str(result))
    except Exception as e:
        print(f"ASR failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
