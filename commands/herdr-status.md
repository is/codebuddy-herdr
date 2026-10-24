---
description: "Show how this CodeBuddy session appears inside Herdr (state, resume command, agent list)."
argument-hint: "[pane_id]"
---

You are running inside a Herdr pane if `HERDR_ENV=1`. Report the current Herdr
visibility of this CodeBuddy session by running these commands (do not just
describe them — actually run them):

```bash
# Is CodeBuddy reporting to Herdr at all?
echo "HERDR_ENV=$HERDR_ENV PANE=$HERDR_PANE_ID"

# Full agent list across all Herdr panes
herdr agent list

# This pane's raw state, agent label, and stored resume command
herdr pane get "${HERDR_PANE_ID:-}"
```

Then explain to the user, in plain language:
- whether CodeBuddy is visible in the Herdr sidebar,
- its current state (idle / working / blocked),
- whether a resume command is stored (so a Herdr restart can bring the session back),
- and any restore error Herdr reported.

If `HERDR_ENV` is not `1`, tell the user CodeBuddy is not running inside Herdr and
nothing is being reported.
