#!/usr/bin/python3
"""Write the latest Cursor agent reply for Varterm auto-read."""

import json
import sys
import time
from pathlib import Path


def extract_text(data):
    if isinstance(data, str):
        return data.strip()
    if not isinstance(data, dict):
        return ""
    for key in ("text", "message", "content", "final_text"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            inner = extract_text(value)
            if inner:
                return inner
        if isinstance(value, list):
            parts = [extract_text(item) for item in value]
            joined = " ".join(part for part in parts if part).strip()
            if joined:
                return joined
    return ""


try:
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    raw = ""
    data = {}

text = extract_text(data)
out_dir = Path.home() / ".cursor"
out_dir.mkdir(parents=True, exist_ok=True)
debug = {
    "ts": time.time(),
    "chars": len(text),
    "keys": list(data.keys()) if isinstance(data, dict) else [],
    "text_preview": text[:240],
}
(out_dir / "varterm-last-hook.json").write_text(json.dumps(debug, indent=2), encoding="utf-8")
if text:
    (out_dir / "varterm-last-agent.json").write_text(
        json.dumps({"text": text, "ts": time.time()}),
        encoding="utf-8",
    )

sys.stdout.write("{}\n")
