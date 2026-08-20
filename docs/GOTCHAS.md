# GOTCHAS

Things we got burned by once, and how to avoid them. Cap: 20 entries / 100 lines.
Add an entry only when **all** 4 conditions hold: time was actually lost / reproducible / not obvious from docs alone / still valid next time.
Entries are written in English; user quotes and error messages stay verbatim in their original language.

## Environment & tools

**On Windows, extracting with `python -c "print(...)" > file` corrupts Korean text**
Cause: Windows Python's stdout encoding is `cp949`, so the UTF-8 source gets damaged during redirection. The source file is intact and only the extracted copy is broken, which makes it easy to misdiagnose.
Fix: use a binary write — `open(path,'wb').write(s.encode('utf-8'))`. (Windows / last recurrence: 2026-07)

**A `raw.githubusercontent.com` download 404s, but curl exits 0 and leaves a 0-byte file**
Cause: without `-f` the 404 body is written to the output path and the exit status stays 0, so a port "succeeds" with an empty file. Upstream layouts move — anthropics/skills relocated everything under `skills/`.
Fix: check the file size right after downloading; when a path is in doubt, resolve the real one through the git trees API instead of guessing. (last recurrence: 2026-08)

**A Markdown "line-break cleanup" lands in the source but changes nothing on screen**
Cause: Markdown folds a single source newline into the same paragraph, so an agent that "splits" a run-on line with bare newlines produces a clean-looking `git diff` while the rendered output stays identical — the review passes on the diff and the user still sees one blob.
Fix: split with blank lines or bullets, never bare newlines; verify by rendering (GitHub markdown API or a local renderer) and treat an unchanged blank-line count as the tell. Cost so far: a full fail→redo→re-review cycle. (last recurrence: 2026-08)

**Korean text sent through AskUserQuestion gets corrupted**
Cause: on long structured Korean input the `\uXXXX` escapes break and the Korean the model produced is itself damaged (observed: `비밀번호`→`뱄뱈호`, `형상관리자`→`슬파리관자`). 11% failure rate (11 of 101: 8 user rejections, 3 InputValidationError).
Fix: write Korean in AskUserQuestion arguments as **literal UTF-8 characters**, never as hand-recalled `\uXXXX` escapes. Once a string is corrupted it gets copied forward into later turns. (last recurrence: 2026-08)

## Permissions & settings

**A wrapper prefix bypasses permission patterns entirely**
Cause: the only wrappers the permission matcher strips are `timeout`/`nice`/`nohup`/`env`. `rtk git push --force` or `rtk proxy git push --force` matches no `git push …` pattern anywhere and passes through the `Bash(rtk:*)` allow.
Fix: write dangerous-command patterns in the generalized form with a leading `*` — `Bash(* git push *--force*)`. Adding per-wrapper mirrors does not scale. (last recurrence: 2026-07)

**Session-start markers get missed — or never appear at all after a hook fix**
Cause: markers are text signals with no enforcement and the user message right after them grabs the attention; and hooks in `.claude/settings.json` load only at session start, so `/clear` (context only) never re-reads them.
Fix: check the markers in the session-start output **before** handling the user's request; if a just-fixed hook shows nothing, quit and restart Claude before suspecting the hook logic itself. (last recurrence: 2026-07)

**`.claude/settings.json` edits cannot be pushed through by any agent, even after a permission-mode switch**
Cause: two independent walls. Any `[Self-Modification]` edit trips the permission-mode classifier regardless of allow rules, and the classifier explicitly refuses relayed prompts ("a delegated prompt is not the user's approval"); on top of that the file's OWN `permissions.deny` lists Edit/Write on itself, and deny outranks allow/ask.
Fix: the user edits it by hand. A mode switch only clears the classifier (confirmed 2026-08 on the MCP allow edit), never the deny rule — do not burn turns re-spawning agents on the same edit. (last recurrence: 2026-08)

## Output style & plugins

**Output style footguns: plugin `force-for-plugin` and brief-style keys**
Cause: a plugin carrying `force-for-plugin` silently replaces the configured output style; removing `keep-coding-instructions: true` silently drops the built-in engineering instructions; editors flag `outputStyle` as "Property not allowed" (absent from public schema) though it works.
Fix: if answer tone changes after a plugin install, check `force-for-plugin` first; keep the `keep-coding-instructions` key; ignore the schema warning. (last recurrence: 2026-07)

## Agents & delegation

**Agent spawns with a `name` param idle without doing any work**
Cause: named spawns (background AND sync) route through the teammate mailbox and never receive their instructions — 6 no-ops across 3 sessions; unnamed spawns ran fine every time (sync and background alike).
Fix: spawn subagents unnamed — background is fine, the `name` param alone is the trigger; distrust idle notifications — verify outputs (files/commits) before proceeding. (last recurrence: 2026-07)

**Transcript-based measurement lies: parallelism flags, line-based greps, and subagent internals**
Cause: the Agent tool_result is always `"status":"async_launched"` regardless of the `run_in_background` flag; transcript JSONL records one content block per line, so a "two tool_use on one line" grep reports zero even for truly parallel calls; and `isSidechain:true` appears 0 times — per-agent token spend and in-agent slow calls are not derivable at all, only main-thread numbers exist.
Fix: group tool_use blocks by `message.id` for fan-out width and read the cc1/cc2/cc3+ figures from `bash scripts/fanout.sh 99 --all`; for in-agent instrumentation, require the agent to report it itself in the delegation prompt. (last recurrence: 2026-08)

**A subagent condemns something because its view of the repo is incomplete**
Cause: two shapes. (a) parallel or back-to-back agents each read the snapshot as of their own start — one reported CLAUDE.md as un-revised when another had already revised it that session; (b) each Orca worktree checks out only its own branch, so a reviewer verifying a claim against `git log` in its own tree finds nothing and calls a correct release-note item invented.
Fix: never take a cross-file contradiction or a "fabricated claim" verdict at face value — grep the file directly, and check `git log --all` (or the sibling branch) for the supporting commit. Cost so far: a full fail→fix→re-review cycle. (last recurrence: 2026-08)

**A file written from inside a worktree is invisible to a reader running in the main repo**
Cause: a bare-relative path resolves against the isolated worktree's own tree, so the main-repo reader finds nothing and the unit silently reads as "never started" — no error anywhere.
Fix: anchor on `git rev-parse --git-common-dir`, then strip the trailing `.git` and then the slash (`${r%.git}` → `${r%/}`); a main checkout returns a bare `.git`, so a single `%/.git` strip silently no-ops exactly there. (last recurrence: 2026-08)

**A broken root-assembly in the status one-liner materializes a ghost directory like `.git*-C*C:` at the repo root**
Cause: when the `git rev-parse` output feeding the one-liner's `root` variable is malformed (stray newline/argv fragments), Windows maps the illegal path characters (`:`, LF) to Unicode private-use characters and happily creates a directory literally named from the broken string — the status write "succeeds" into a garbage path and the board shows nothing.
Fix: if `git status` shows an untracked directory with PUA/garbled characters around `.git`/`-C`, it is this — delete it and check the writer's root assembly; the reader never sees those writes.
(Windows / last recurrence: 2026-08)

**Orca operational traps: an idle-looking child, a worktree pulled out from under a live proxy, and a `--version` that does not exist**
Cause: four shapes. (a) the child loads the same CLAUDE.md, so it re-asks approvals the parent already collected and waits on an AskUserQuestion nobody answers (2 recurrences, 2-3 proxy round trips lost each), and `orca terminal read` is a diff-based line log (2000-line retention), not a screen snapshot, so a dialog scrolled out of the buffer reconstructs as an empty idle prompt; (b) removing or replacing a worktree while an older proxy is still attached to it garbles that proxy's `terminal read` into interleaved text, and the proxy concludes the prompt never reached the child — a fake delivery failure; (c) `orca --version` does not exist and prints usage; (d) a child with bypass-permissions ON still halts on AskUserQuestion (bypass does not cover it), and the parent-side `tui-idle` wait returns satisfied while the child's own internal subagents are still running — so a blocked child reads as a finished one; this session it consumed 3 proxy round trips.
Fix: every Orca child delegation prompt must state "already approved in the parent session — run to completion without any confirmation questions (no AskUserQuestion)" plus a 1-line approved-scope summary (mandated in orchestrator.md Orca mode since 78772b4; older derived projects need it manually until /template-update); before calling a terminal idle, send one harmless keystroke (a single Down arrow) via `orca terminal send` to force a redraw and read again; never remove a worktree while its previous proxy is live — wait for that proxy's completion notification, or create a NEW worktree under a different name and clean the abandoned one up at land time; read the version from `orca status --json` → `result.runtime.appVersion` (1.4.185 as of 2026-08); judge completion by commit existence (`git log --oneline` in the worktree), never by idle; on idle, check for a pending dialog before concluding. (last recurrence: 2026-08)

**A delegation prompt never reaches the Orca child, yet spawn and send both report success**
Cause: four shapes. (a) on Windows, `orca worktree create --prompt "<long prompt>"` — cmd reads embedded `"` as quote toggles, argv splits, the spawned Claude prints its version and exits. (b) `orca terminal send --text "..."` only **types** into the input box; without `--enter` it is never submitted. (c) a long `--text` payload arrives **truncated at the front**, so the child breaks constraints stated early in the prompt and looks like a disobedient agent rather than a delivery failure, with the leftover tail still sitting un-submitted in the box (2 occurrences in one session). (d) the prompt lands intact and the child silently substitutes its own design for the specified one — two attempts rendered a different label notation than the spec demanded, one of them ending staged-but-uncommitted (2 discard/redo cycles, ~20 min).
Fix: spawn bare, write the delegation prompt to a file in the worktree, and send only a short "TASK-PROMPT.md를 읽고 그대로 수행" line with `--enter`; at the ~1-minute liveness read, treat a version banner (a) or prompt text visible in the input box (b/c) as this exact failure — not as a slow start; for (d) put the exact output spec in TASK-PROMPT.md with an explicit "이 표기를 바꾸지 말 것" line, make the child re-read that section right before committing, and confirm with `git log --oneline` that a commit actually exists — staged-only is a failure mode, not a success. (Windows for (a) / last recurrence: 2026-08)

## Template machinery

**Any change to template-update.sh — paths array or the script's own guards — takes effect in derived projects only on the SECOND run**
Cause: run 1 executes the project's old script copy; it checks out `scripts/` (bringing the new version) but keeps iterating the old in-memory array and the old code path. So addition lag was misread as "cheatsheet 누락", a removed path (e.g. ci.yml) still gets clobbered one last time, and the new backup+diff guard for CLAUDE.md / settings.json does not protect run 1 at all.
Fix: in the derived project, commit everything before the first `/template-update` — that is the only safety net for run 1; expect the lag and check `git diff --cached` after it (a bare `git diff` is empty, the checkout already staged everything); guards and array changes are reliable from run 2. Skills are immune (the array syncs `.claude/skills` wholesale, a4bc58e).
(last recurrence: 2026-08)

**A malformed root-level JSON file sails through CI**
Cause: ci.yml's JSON-validity step rglobs `.claude/` only, so `.mcp.json` and every other root-level JSON sits in a blind spot.
Fix: validate root JSON locally before committing (`python -c "import json;json.load(open('.mcp.json'))"`); widen the step's target list if root JSON files multiply.
(last recurrence: 2026-08)

**Concurrent sessions on one repo silently author conflicting edits to the same rule file**
Cause: two sessions processed the same user feedback in parallel; both rewrote the same orchestrator.md bullet — push was rejected and the rebase needed a semantic (not textual) merge.
Fix: `git fetch` and check ahead/behind before authoring template-rule commits; on conflict, merge both rule sets' obligations instead of picking a side.
(last recurrence: 2026-08)

**Bash tool silently mangles — or flatly rejects — certain inline command strings**
Cause: the harness unescapes `\\` once before bash receives it, so escape-sensitive inline test fixtures mutate (a doubled-backslash sequence arrives single); a literal U+FFFD anywhere in the command is refused with the misleading "command contains control characters…"; and on Windows, MSYS path conversion rewrites an inline colon-bearing git revspec — `git show origin/main:.claude/…` reaches git as `origin\main;.claude\…`.
Fix: generate fixtures into files (python chr(92), printf octal escapes, or the Write tool) and pipe them; in mojibake-detection scripts build the character with `chr(0xFFFD)` instead of pasting it; pass revspecs as list args via `subprocess.run(['git','show',…])` instead of an inline shell string. (last recurrence: 2026-08)

**A `|`-delimited record parsed with bash builtins loses its last field, or takes seconds per line**
Cause: `read -r -a` silently drops a **trailing empty field**, so a `|`-terminated record arrives one field short and an exact field-count check discards the whole record with no error; separately, `read` on a long line and `${s:i:1}` indexing are each O(line length), so a builtin-only parse loop is quadratic.
Fix: do not require an exact field count on data you did not write — count from the front and tolerate a short tail; bound the read with `read -n <max>` rather than clipping after the read (measured 1827ms → 37ms). (last recurrence: 2026-08)
