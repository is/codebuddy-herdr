# AGENTS.md — codebuddy-herdr

Guidance for AI agents (and humans) working on this plugin.

## What this plugin does

Makes CodeBuddy a first-class citizen inside **Herdr** (https://herdr.dev), the
terminal multiplexer that hosts coding agents. It reports CodeBuddy's state to
Herdr through CodeBuddy hook events so the Herdr sidebar, `herdr agent list`,
and `herdr agent wait` reflect CodeBuddy's real status:

| CodeBuddy event   | Herdr state  |
| ---               | ---          |
| SessionStart      | idle (+ stores resume command) |
| UserPromptSubmit  | working      |
| PreToolUse        | working      |
| Stop              | idle         |
| Notification (permission/prompt/decision) | blocked |
| SessionEnd        | release agent |

## Architecture (read this before changing code)

- `src/herdr-report.ts` — the reporter source. Its committed Node build output,
  `bin/herdr-report.js`, is invoked by **every** hook event (see
  `hooks/hooks.json`) with the hook JSON on stdin. It talks
  **directly to the Herdr socket API** (`HERDR_SOCKET_PATH`) using
  newline-delimited JSON — NOT the `herdr` CLI, which is slower and not meant
  for high-frequency reporting.
- `hooks/hooks.json` — wires the 6 events above to the reporter. The hook
  command is `node "$CODEBUDDY_PLUGIN_ROOT/bin/herdr-report.js" || true`,
  so a failure never breaks the user's session.
- `commands/herdr-status.md` — the `/codebuddy-herdr:herdr-status` command,
  a read-only helper that shows how this session appears inside Herdr.
- `skills/herdr/SKILL.md` — reference/debugging skill (loaded by the plugin).
- `script/install-dev.sh` — dev install: installs the plugin into CodeBuddy
  and replaces the cached copy + package-sources copy with **symlinks** to this
  source dir, so edits apply live via `/reload-plugins`.
- `.codebuddy-plugin/plugin.json` — the manifest (the only file in that dir).

## Hard rules

1. **Never use the reserved `herdr:` source prefix.** The reporter's source is
   `"codebuddy"`. Herdr reserves `herdr:` for its own integrations.
2. **No-op unless `HERDR_ENV=1`.** Outside Herdr the reporter exits 0
   immediately. Do not add side effects that run outside Herdr.
3. **Never block the user's session.** The reporter swallows all errors, uses a
   0.5s socket timeout, and the hook command ends with `|| true`. Do not add
   network calls, blocking waits, or loud failures.
4. **`seq` must be monotonically increasing** per pane. The reporter derives it
   from `time.time_ns()` + a persisted counter file in `$TMPDIR`
   (`herdr-codebuddy-seq-<pane>`), guarded by `fcntl.flock`. Never send a
   non-increasing seq or Herdr will reject the update.
5. **Resume command rules** (Herdr): `resume_argv`'s first token must be a
   plain command on PATH, no apostrophes/control chars, ≤64 args, ≤8 KiB.
   We store `["codebuddy", "--resume", session_id]`.
6. **One logical change per commit.** Keep diffs small and reviewable.

## Testing inside Herdr

This plugin can only be meaningfully tested from inside a Herdr pane:

```bash
# Sanity: confirm the environment
echo "HERDR_ENV=$HERDR_ENV PANE=$HERDR_PANE_ID"

# Drive a state transition manually
echo '{"hook_event_name":"PreToolUse","session_id":"test"}' \
  | node "$CODEBUDDY_PLUGIN_ROOT/bin/herdr-report.js"
herdr pane get "$HERDR_PANE_ID"
herdr agent list
```

Verify the state changes (working / blocked / idle) appear in `herdr agent
list`. A restart of Herdr should restore the stored resume command from its
snapshot.

## Local install (dev)

```bash
bash script/install-dev.sh      # symlinks source into CodeBuddy, enables plugin
# then in CodeBuddy: /reload-plugins
```

Re-run the script if a CodeBuddy restart replaced the symlink with a copy.
