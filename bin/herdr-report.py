#!/usr/bin/env python3
# Report CodeBuddy agent state to Herdr over its local socket API.
# Invoked by CodeBuddy hook events (see ../hooks/hooks.json). Hook JSON arrives
# on stdin. No-op unless HERDR_ENV=1. Never blocks, never fails loudly.
# Protocol: newline-delimited JSON over a Unix socket (HERDR_SOCKET_PATH).
#   request = {"id": str, "method": str, "params": {...}}
#   methods = pane.report_agent | pane.report_agent_session | pane.release_agent

import fcntl
import json
import os
import socket
import sys
import tempfile
import time

SOURCE = "codebuddy"
AGENT = "CodeBuddy"
RESUME_BIN = "codebuddy"


def _seq_path():
    pane = os.environ.get("HERDR_PANE_ID", "none")
    safe = pane.replace(":", "_")
    return os.path.join(tempfile.gettempdir(), "herdr-codebuddy-seq-" + safe)


def next_seq():
    base = time.time_ns()
    path = _seq_path()
    try:
        with open(path, "a+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            handle.seek(0)
            content = handle.read().strip()
            last = int(content) if content.isdigit() else 0
            seq = base if base > last else last + 1
            handle.seek(0)
            handle.truncate()
            handle.write(str(seq))
        return seq
    except Exception:
        return base


def send(method, params, timeout=0.5):
    socket_path = os.environ.get("HERDR_SOCKET_PATH")
    if not socket_path:
        return
    request = {
        "id": SOURCE + ":" + str(int(time.time() * 1000)) + ":" + str(os.getpid()),
        "method": method,
        "params": params,
    }
    try:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(timeout)
        client.connect(socket_path)
        client.sendall((json.dumps(request) + "\n").encode("utf-8"))
        try:
            client.recv(4096)
        except Exception:
            pass
        client.close()
    except Exception:
        pass


def report_state(pane, state, seq, message=None):
    params = {
        "pane_id": pane,
        "source": SOURCE,
        "agent": AGENT,
        "state": state,
        "seq": seq,
    }
    if message:
        params["message"] = message
    send("pane.report_agent", params)


def main():
    if os.environ.get("HERDR_ENV") != "1":
        return 0
    pane = os.environ.get("HERDR_PANE_ID")
    if not pane:
        return 0

    raw = ""
    try:
        raw = sys.stdin.read()
    except Exception:
        raw = ""

    hook = {}
    if raw.strip():
        try:
            hook = json.loads(raw)
        except Exception:
            hook = {}

    event = str(hook.get("hook_event_name") or "")

    if event == "SessionStart":
        seq = next_seq()
        session_id = hook.get("session_id")
        transcript = hook.get("transcript_path")
        params = {
            "pane_id": pane,
            "source": SOURCE,
            "agent": AGENT,
            "state": "idle",
            "seq": seq,
        }
        if isinstance(session_id, str) and session_id:
            params["agent_session_id"] = session_id
            params["resume_argv"] = [RESUME_BIN, "--resume", session_id]
        if isinstance(transcript, str) and transcript:
            params["agent_session_path"] = transcript
        send("pane.report_agent", params)
        return 0

    if event in ("UserPromptSubmit", "PreToolUse"):
        report_state(pane, "working", next_seq())
        return 0

    if event == "Stop":
        report_state(pane, "idle", next_seq())
        return 0

    if event == "Notification":
        ntype = str(hook.get("notification_type") or "").lower()
        message = str(hook.get("message") or "")
        if "permission" in ntype or "prompt" in ntype or "decision" in ntype:
            report_state(pane, "blocked", next_seq(), message=message or "needs input")
        return 0

    if event == "SessionEnd":
        send(
            "pane.release_agent",
            {"pane_id": pane, "source": SOURCE, "agent": AGENT, "seq": next_seq()},
        )
        return 0

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
