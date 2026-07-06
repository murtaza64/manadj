// Session-identity plugin (parallel-process issue 07, ADR 0026).
// Exposes each session's own ID to its shell executions as
// $OPENCODE_SESSION_ID, so registry `owner:` stamping and the
// guard.py/land.py ownership checks are mechanical instead of best-effort.
//
// Mechanism: the `shell.env` hook — env is set at process-spawn level,
// invisibly (its input carries sessionID per @opencode-ai/plugin types).
// v1 used tool.execute.before to prepend an `export` line to bash commands;
// that mutated the visible command text and read as tampering to agents.
// Identity only — no policy, no interception, no blocking (the enforcement
// plugin has a written escalation trigger in docs/agents/parallel-work.md).

export const SessionIdentityPlugin = async () => {
  return {
    "shell.env": async (input, output) => {
      if (input.sessionID) {
        output.env.OPENCODE_SESSION_ID = input.sessionID
      }
    },
  }
}
