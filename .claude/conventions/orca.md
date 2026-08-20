# Orca dispatch convention — child worktree agents from inside the ADE

Applies only when the session-start output carries the `ORCA-ENV` marker. This file is the
**orchestrator's own** command reference for Orca dispatch. The orchestrator has no shell;
orca CLI execution goes through a **unified proxy** (one `model: haiku` implementer per
child, owning create → wait → read → status-set start to finish). The proxy does **not**
read this file — the orchestrator spells the exact command sequence out in the proxy's
delegation prompt, and Reads this file itself only when the syntax is uncertain.
Commands below were verified against orca CLI 1.4.185 on Windows — every flag used in this
file re-verified 2026-08-20 against `orca <cmd> --help`, all unchanged since 1.4.184. There
is no `orca --version`; the version is `result.runtime.appVersion` from `orca status --json`.
A longer, version-matched guide ships with the CLI itself: `orca skills get orca-cli` — it is
the **authoritative syntax reference**. Consult it (or `orca <cmd> --help`) *before* guessing a
flag or re-delegating to find one out; a session lost a round trip re-delegating instead.

## 0. Preconditions

- Detection is two-part and conservative: the `ORCA-ENV` marker fires only when an
  Orca-injected env var (`ORCA_TERMINAL_HANDLE`, or `TERM_PROGRAM=Orca`) is present **and**
  `command -v orca` resolves. A machine with only the CLI installed (no ADE around the
  session) gets no marker and stays on internal subagents.
- Prefer `--json` on every call; parse fields instead of scraping text.
- If any orca call fails, do not retry blindly — report the failure so the orchestrator
  can fall back to an internal subagent.

## 1. Spawn one child agent per delegation unit

```
orca worktree create --name <unit-name> --agent claude --json
```

- Start the child **bare or with a minimal one-line `--prompt`** — never pass the full
  delegation prompt via `--prompt`. On Windows, cmd treats embedded `"` in the prompt as
  quote toggles: argv splits, the child prints its version and exits, yet creation still
  reports success. Deliver the full delegation prompt after spawn via
  `orca terminal send` as typed input (see §2) — typed input bypasses shell quoting
  entirely and is OS-independent.
- **`--enter` is mandatory on that send.** A bare `send` only *types* the text into the
  child's input box; without `--enter` nothing is submitted and the child idles on an
  un-submitted prompt while both create and send report success:

  ```
  orca terminal send --terminal <handle> --text "<full delegation prompt>" --enter --json
  ```
- One worktree per unit; Orca gives it its own branch and a separate terminal card.
- From the JSON result capture two values and return them to the orchestrator:
  - worktree id — the full `result.worktree.id`, shaped `<repo-id>::<path>` (a bare repo
    id is not a worktree id)
  - agent terminal handle — `result.agentTerminalHandle`; older runtimes return only
    `result.startupTerminal.handle`; if neither is present, recover it with
    `orca terminal list --json`
- The child branches from the repo default base ref. If the unit must include the
  session's unpushed work, commit first and pass `--base-branch <session-branch>`.
- Do not bare-create and then `terminal create` the agent — `--agent` in one step is the
  supported path (the two-step variant leaves a stray fallback shell).

## 2. Monitor and collect results

```
orca worktree ps --json                                              # board sweep: all worktrees + status
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 300000 --json
orca terminal read --terminal <handle> --cursor <prev> --limit 1000 --json
```

- Liveness check first: ~1 minute after delivering the prompt, `terminal read` and
  confirm signs of actual work (tool calls, file exploration, a moving token counter).
  If the output shows only a startup prompt/version banner, the prompt text sitting
  un-submitted in the input box (the missing `--enter`), or the child is dead, the
  prompt never took — diagnose and report immediately instead of entering the long wait.
- `terminal wait --for tui-idle` is the completion signal for TUI agents (Claude Code
  included); always pass `--timeout-ms`. A timeout is "still running", not an error.
- A `terminal wait` timeout returns `ok: false` with `error.code: "timeout"` — interpret
  this as "still running", not as a failure.
- `terminal read` is cursor-based: read once before/at spawn, then read with
  `--cursor <nextCursor from the previous read>` to get only the new output (the agent's
  final report). `--limit` raises the retained-line window.
- Card status on the Orca board (`workspaceStatus`) is worktree metadata:
  `orca worktree set --worktree id:<repo-id>::<path> --workspace-status in-review --json`
  (default ids: todo, in-progress, in-review, completed).
- Handles are runtime-scoped: after an Orca restart or a `terminal_handle_stale` error,
  reacquire with `orca terminal list --json` and continue with the replacement.
- `orca terminal send` is the prompt-delivery channel (§1), not just for follow-ups —
  the same typed-input path also sends follow-up instructions to a live child. Every
  send that carries an instruction needs `--enter`; omit it only for a deliberately
  unsubmitted keystroke (e.g. a single arrow key to force a TUI redraw).

## 3. Merge and clean up (single-track worktrees)

In Orca mode the template's own isolation (`isolation: worktree` under
`.claude/worktrees/`) is **not used** — Orca worktrees are the only worktrees. The
landing flow keeps the same order as `/land` but swaps the enumeration and removal
commands:

```
orca worktree list --json          # instead of: git worktree list
git merge --no-ff <child-branch>   # unchanged: merge into the session branch, dependency order
orca worktree rm --worktree id:<repo-id>::<path> --json   # instead of: git worktree remove + prune
```

- Merge only after the child's result is collected and reviewed; never reset or force.
- `orca worktree rm` refuses when uncommitted changes remain unless `--force` — inspect
  before forcing, exactly like the `/land` rule for `git worktree remove`.
- Unmerged children stay open and are listed in the report as still open.
