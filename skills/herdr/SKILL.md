---
name: herdr
description: Reports CodeBuddy activity to Herdr, the terminal multiplexer that hosts coding agents. Use when the user mentions Herdr, wants agent state to show in the Herdr sidebar, or asks to verify or debug the CodeBuddy-Herdr integration.
---

# Herdr integration for CodeBuddy

Herdr (https://herdr.dev) is the terminal runtime that hosts this CodeBuddy
session. The codebuddy-herdr plugin already automates reporting through
CodeBuddy hooks, so you normally do NOT need to call Herdr yourself. This skill
is for understanding and debugging that reporting.

## How it works (read-only reference)

Every process in a Herdr pane inherits these environment variables:

| Variable | Meaning |
| --- | --- |
| HERDR_ENV | 1 when running inside Herdr |
| HERDR_PANE_ID | The pane this CodeBuddy runs in |
| HERDR_BIN_PATH | The Herdr binary that owns the pane |
| HERDR_SOCKET_PATH | Herdr local API socket (Unix socket) |

The plugin hook script (bin/herdr-report.js, built from src/herdr-report.ts)
reports three things to Herdr via
its socket API (pane.report_agent, pane.report_agent_session,
pane.release_agent):

1. State: working on UserPromptSubmit, PreToolUse, or PostToolUse, idle on Stop,
   blocked on a permission or decision Notification.
2. Resume command: on SessionStart it stores "codebuddy --resume SESSION_ID" so
   Herdr can reopen the same session after a server restart.
3. Release: on SessionEnd it clears the agent from the pane.

The plugin source is "codebuddy"; it must not use the reserved "herdr:" prefix.

## Debugging

If the user says CodeBuddy is not showing up in Herdr, or state looks wrong:

1. Confirm HERDR_ENV=1 in this shell.
2. Run "herdr agent list" and "herdr pane get $HERDR_PANE_ID".
3. Check the seq counter file in $TMPDIR/herdr-codebuddy-seq-* (one per pane).
4. Manually exercise a report:

   echo '{"hook_event_name":"PreToolUse","session_id":"test"}' \
     | node "$CODEBUDDY_PLUGIN_ROOT/bin/herdr-report.js"
   herdr pane get "$HERDR_PANE_ID"

Do not call "herdr pane report-agent" from model actions unless the user asks
for a manual override; the hooks already keep Herdr in sync.
