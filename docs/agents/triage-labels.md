# Triage Labels

The skills speak in terms of five canonical triage roles. This table maps
those roles to gh label state on `murtaza64/manadj` (full model:
`~/dotfiles/docs/tracker-ops/gh.md` — at most one who-acts-next marker).

| Role in mattpocock/skills | On our tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | open, no marker label | Untriaged (derived state, not a label) |
| `needs-info` | `needs-info` | Waiting on reporter |
| `ready-for-agent` | `ready-for-agent` | Fully specified, delegable |
| `ready-for-human` | `parked` (finished work awaiting review) or `needs-human` (not delegable) | |
| `wontfix` | close `--reason "not planned"` + `wontfix` label | Will not be actioned |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use
the corresponding gh state from this table.
