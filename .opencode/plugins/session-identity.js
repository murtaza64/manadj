// Session-identity plugin (parallel-process issue 07, ADR 0026).
// Exposes each session's own ID to its bash executions as
// $OPENCODE_SESSION_ID, so registry `owner:` stamping and the
// guard.py/land.py ownership checks are mechanical instead of best-effort.
// Identity only — no policy, no interception, no blocking (the enforcement
// plugin has a written escalation trigger in docs/agents/parallel-work.md).

export const SessionIdentityPlugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const id = input.sessionID
      if (!id || !output?.args?.command) return
      // Idempotent: don't stack exports on retried/edited commands.
      if (output.args.command.startsWith("export OPENCODE_SESSION_ID=")) return
      output.args.command =
        `export OPENCODE_SESSION_ID=${JSON.stringify(id)}; ` + output.args.command
    },
  }
}
