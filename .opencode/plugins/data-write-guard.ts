// Hard write-guard for the real library DB (incident 2026-07-08).
//
// Blocks file-tool writes (write/edit/patch) into ~/manadj/data for EVERY
// agent and session — deterministic path containment, no permission-pattern
// matching. Exists because opencode's `edit` permission deny rules were
// observed inert (agent- and project-level, all pattern syntaxes) while
// `external_directory` matches directories and cannot distinguish reads
// from writes. Config cannot express "readable, never writable"; this can.
//
// The app itself (SQLite via the backend) is unaffected — this hooks
// opencode tool calls only. Sanctioned paths into data/: the backend,
// scripts/agent/db_backup.py, and lane_app.py's internal clone.

import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const DATA_DIR = path.join(os.homedir(), "manadj", "data")
const WRITE_TOOLS = new Set(["write", "edit", "patch"])

function resolvedTarget(fp: string): string {
  const abs = path.resolve(fp)
  // realpath the parent (file itself may not exist yet) to catch symlink routes
  try {
    return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs))
  } catch {
    return abs
  }
}

export const DataWriteGuard: Plugin = async () => ({
  "tool.execute.before": async (input, output) => {
    if (!WRITE_TOOLS.has(input.tool)) return
    const fp = (output as any)?.args?.filePath
    if (typeof fp !== "string") return
    const target = resolvedTarget(fp)
    if (target === DATA_DIR || target.startsWith(DATA_DIR + path.sep)) {
      throw new Error(
        `BLOCKED by data-write-guard: file-tool writes into ${DATA_DIR} are ` +
          `forbidden — that is the real library DB (see incident 2026-07-08, ` +
          `docs/adr/0028). The backend owns this directory; backups go ` +
          `through scripts/agent/db_backup.py.`,
      )
    }
  },
})
