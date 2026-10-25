# codebuddy-herdr

Make CodeBuddy a first-class citizen inside **Herdr** — the terminal multiplexer
that hosts coding agents (https://herdr.dev).

This plugin reports CodeBuddy's live state to Herdr so the Herdr sidebar,
`herdr agent list`, and `herdr agent wait` reflect what CodeBuddy is actually
doing. It also stores a resumable session command and cleanly releases the pane
on exit.

## Install

### Normal (packaged)

Install directly from the source repository on cnb.cool:

```bash
codebuddy plugin add https://cnb.cool/io8/codebuddy-herdr -y
codebuddy plugin enable codebuddy-herdr
```

> No `.git` suffix is needed — CodeBuddy treats the URL as a git repository
> automatically. The plugin installs under an ID like
> `codebuddy-herdr@git-<hash>` and is disabled by default; `plugin enable`
> (shown above) activates it. Run `/reload-plugins` (or start a new session)
> to apply.

You can also install from a local path or any other git repo:

```bash
codebuddy plugin add <path-or-repo> -y
codebuddy plugin enable codebuddy-herdr
```

#### From a GitHub HTTPS repo

This project is also mirrored on GitHub — install directly over HTTPS:

```bash
codebuddy plugin add https://github.com/is/codebuddy-herdr -y
codebuddy plugin enable codebuddy-herdr
```

> No `.git` suffix required. To pin to a branch, tag, or commit, append
> `#<ref>` (e.g. `.../codebuddy-herdr#main` or `.../codebuddy-herdr#v1.2.3`).

### Dev (live symlink)

For local development, `script/install-dev.sh` installs the plugin and replaces
CodeBuddy's cache copy **and** package-sources copy with symlinks to this source
directory, so edits apply live after `/reload-plugins`.

```bash
bash script/install-dev.sh
# then in CodeBuddy: /reload-plugins
```

> CodeBuddy keeps a hash-based plugin cache. A full CodeBuddy restart can replace
> the symlink with a copy — just re-run `script/install-dev.sh` to restore it.

## What it reports

| CodeBuddy event   | Herdr state  | Notes |
| ---               | ---          | ---   |
| SessionStart      | `idle`       | also stores `codebuddy --resume <session_id>` so Herdr can reopen the session after a restart |
| UserPromptSubmit  | `working`    | |
| PreToolUse        | `working`    | |
| Stop              | `idle`       | |
| Notification (permission / prompt / decision) | `blocked` | surfaces the pending question as the message |
| SessionEnd        | release      | clears the agent from the pane |

These states show up in the Herdr sidebar and `herdr agent list`, and drive
`herdr agent wait`.

## How it works

- CodeBuddy fires hook events; `hooks/hooks.json` runs
  `node "$CODEBUDDY_PLUGIN_ROOT/bin/herdr-report.js" || true` for each of the
  six events above. The `|| true` and the script's own error-swallowing keep
  your session safe even if Herdr is unavailable.
- `src/herdr-report.ts` is the TypeScript source; its checked-in build output,
  `bin/herdr-report.js`, reads the hook JSON from stdin and talks **directly to
  the Herdr local socket API** (`HERDR_SOCKET_PATH`) using newline-delimited
  JSON — not the slower `herdr` CLI. It is a no-op unless `HERDR_ENV=1`.
- The integration source is `codebuddy` (the reserved `herdr:` prefix is for
  Herdr's own integrations).

## Usage

Once installed and enabled, reporting happens automatically inside any Herdr
pane. To inspect how this session appears in Herdr, run the bundled command:

```
/codebuddy-herdr:herdr-status
```

It shows `HERDR_ENV`, the pane id, `herdr agent list`, and `herdr pane get` for
this pane, and explains the current state.

## Files

```
codebuddy-herdr/
├── .codebuddy-plugin/plugin.json   # plugin manifest
├── hooks/hooks.json                # wires 6 hook events to the reporter
├── src/herdr-report.ts              # TypeScript reporter source
├── bin/herdr-report.js              # prebuilt Node runtime for hooks
├── commands/herdr-status.md        # /codebuddy-herdr:herdr-status helper
├── skills/herdr/SKILL.md           # debugging reference skill
└── script/install-dev.sh           # dev install (symlink) script
```

## Requirements

- CodeBuddy with plugin support.
- Herdr 0.9+ running the pane (state is only reported when `HERDR_ENV=1`).
- Node.js 18+ and the standard Unix `flock` utility available on PATH. The
  packaged runtime has no npm dependencies; TypeScript is only needed to build
  from source (`npm ci && npm run build`).

## License

MIT — see repository for details.
