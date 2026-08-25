#!/usr/bin/python3
"""Write the latest Cursor agent reply for Varterm auto-read."""

import json
import sys
import time
from pathlib import Path

try:
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    data = {}

text = (data.get("text") or "").strip()
out = Path.home() / ".cursor" / "varterm-last-agent.json"
out.parent.mkdir(parents=True, exist_ok=True)
if text:
    out.write_text(json.dumps({"text": text, "ts": time.time()}), encoding="utf-8")

sys.stdout.write("{}\n")
