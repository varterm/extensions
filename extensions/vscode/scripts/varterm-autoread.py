#!/usr/bin/python3
"""Write the latest Cursor agent reply for Varterm auto-read."""

import hashlib
import json
import sys
import time
from pathlib import Path

# Per-workspace replies older than this are dropped on the next write. Without
# it the directory keeps a file for every project ever opened.
REPLY_TTL_SECONDS = 30 * 24 * 60 * 60


def conversation_file_name(conversation_id):
    """One file per chat tab. The id is untrusted hook input, so it has to be a token."""
    if not isinstance(conversation_id, str):
        return ""
    token = conversation_id.strip()
    if not token or len(token) > 80:
        return ""
    for char in token:
        if char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_":
            return ""
    return f"c-{token}.json"


def write_workspace_reply(out_dir, root, payload):
    """Keep a copy per project.

    The shared file holds one reply for the whole machine, so a window loses its
    own the moment any other window gets an answer. Each window reads back the
    newest file that belongs to it, so the name only has to be unique and stable
    for a given path.
    """
    replies_dir = out_dir / "varterm-agent-replies"
    replies_dir.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(root.encode("utf-8")).hexdigest()[:16]
    (replies_dir / f"{key}.json").write_text(payload, encoding="utf-8")

    cutoff = time.time() - REPLY_TTL_SECONDS
    for stale in replies_dir.glob("*.json"):
        try:
            if stale.stat().st_mtime < cutoff:
                stale.unlink()
        except OSError:
            pass


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
cwd = ""
workspace = ""
conversation_id = ""
if isinstance(data, dict):
    cwd = str(data.get("cwd") or data.get("workspace_root") or "").strip()
    roots = data.get("workspace_roots") or data.get("workspaceFolders") or data.get("workspace_folders")
    if isinstance(roots, list) and roots:
        workspace = str(roots[0])
    elif isinstance(data.get("workspace"), str):
        workspace = data["workspace"].strip()
    conversation_id = str(
        data.get("conversation_id") or data.get("composerId") or data.get("conversationId") or ""
    ).strip()
out_dir = Path.home() / ".cursor"
out_dir.mkdir(parents=True, exist_ok=True)

auto_read_on = True
try:
    store = json.loads((out_dir / "varterm-autoread.json").read_text(encoding="utf-8"))
    # Editor auto-read and the Agents window switch are separate. Either one
    # still wants the reply written down.
    if store.get("enabled") is False and store.get("agentsWindow") is not True:
        auto_read_on = False
except Exception:
    auto_read_on = True

debug = {
    "ts": time.time(),
    "chars": len(text),
    "keys": list(data.keys()) if isinstance(data, dict) else [],
    "cwd": cwd,
    "workspace": workspace,
    "conversation_id": conversation_id,
    "text_preview": text[:240],
    "auto_read": auto_read_on,
}
(out_dir / "varterm-last-hook.json").write_text(json.dumps(debug, indent=2), encoding="utf-8")
if text and auto_read_on:
    payload = json.dumps(
        {
            "text": text,
            "ts": time.time(),
            "cwd": cwd,
            "workspace": workspace,
            "conversationId": conversation_id,
        }
    )
    (out_dir / "varterm-last-agent.json").write_text(payload, encoding="utf-8")
    root = workspace or cwd
    if root:
        try:
            write_workspace_reply(out_dir, root, payload)
            # The per-project file is only the newest chat. Sidebar tabs need
            # their own copy or replay speaks whichever tab finished last.
            name = conversation_file_name(conversation_id)
            if name:
                replies_dir = out_dir / "varterm-agent-replies"
                replies_dir.mkdir(parents=True, exist_ok=True)
                (replies_dir / name).write_text(payload, encoding="utf-8")
        except OSError:
            # The shared file above is what auto-read needs; a failure to keep
            # the per-project copy must not cost the user the reply itself.
            pass

sys.stdout.write("{}\n")
