---
name: import
description: Absorbs an existing standalone repo — one NOT derived from the claude-starter template — into the template system. Reads only the old settings/rule layer (old CLAUDE.md, .claude/, AGENTS.md, README conventions), migrates rules/state/gotchas into docs/, installs the template machinery, and archives the old settings under docs/legacy/. Use when the user invokes /import inside such a repo. Not for the template original, and not for already-derived projects — syncing those is /template-update's job.
---

# /import — absorb a standalone repo into the template system

Runs inside an existing repo that was **not** created from the claude-starter template, and converts only its settings/rules layer to the template system. User-facing communication is in Korean; the documents written for the user (PROJECT-RULES/STATE/GOTCHAS entries) are also in Korean.

SYNC NOTE: 이 문서의 **설치 경로 목록·gitignore 줄·sentinel 규칙**은 다른 파일의 사본이다. 여기를 고치면 아래도 같은 커밋에서 함께 고친다.
- `scripts/template-update.sh` — `paths=()` 배열. 5단계 checkout 명령의 경로 목록이 이것과 일치해야 한다
- `.gitignore` — 5단계가 덧붙이는 ignore 줄 목록의 원본
- `scripts/session-banner.sh` — `.claude/template-origin` sentinel 판정. 이 문서가 sentinel을 가져오지 않는 근거가 여기 로직이다
- `.claude/skills/template-update/SKILL.md` — template remote 등록·URL 1회 질문 규칙을 공유한다

Boundaries — where this skill has no job:
- **Template original (TEMPLATE-REPO session marker)**: nothing to import — abort and tell the user.
- **Already-derived project** (`.claude/template-origin` sentinel exists, or `scripts/template-update.sh` is already present): that repo already runs the template system — point the user to `/template-update` and stop. `/template-update` **syncs** an existing derivation; `/import` **converts** a repo that never was one.

Hard rules:
- **All product/source code stays untouched.** No scanning, no analysis, no refactoring — this skill reads and rewrites only the settings/rules layer.
- **Nothing is deleted.** Every old settings file the template replaces is moved into `docs/legacy/`.
- Orchestrator mode: delegate reading to **explorer** and every file write/move/commit to **implementer**, exactly as `/kickoff` does. The main session composes the migrated document contents itself and puts the full text into the delegation prompt.

## 1. Preconditions
- Must be a git repo with a **clean working tree** — the checkout and the `git mv` backup below overwrite/move silently. Uncommitted changes must be committed or stashed first.
- Check the boundary conditions above (template original / already derived) and abort with the right pointer if either holds.

## 2. Investigate the old settings layer (조사)
Delegate to the **explorer** subagent, with the source-code prohibition stated in the prompt. Read **only** settings/rule documents:
- old `CLAUDE.md` (and `CLAUDE.local.md` if present), everything under the old `.claude/` (settings, commands, agents, rules, skills)
- `AGENTS.md`, codex settings, `.cursorrules` / `.cursor/rules` — whatever other-tool rule files exist
- `README.md` and `docs/` **convention/state sections only** — not product documentation for its own sake
**Do not scan source code.** Receive a summary sorted into 3 buckets:
1. project-specific rules/conventions → destined for `docs/PROJECT-RULES.md`
2. in-progress state / todo items → destined for `docs/STATE.md`
3. gotcha-style knowledge (things that cost time once, with the workaround) → destined for `docs/GOTCHAS.md`

## 3. Report & approval gate (보고·승인) — before any write or move
Present the plan via **one AskUserQuestion** (same gating convention as the other skills — approval before execution):
- what gets **absorbed** and where: the 3 buckets from step 2 with their destination files
- what gets **replaced** by template versions: old `CLAUDE.md`, old `.claude/` machinery, plus `scripts/` and docs skeleton arriving fresh
- what moves to **`docs/legacy/`** (never deleted)
- one line: 제품 코드는 손대지 않는다
Offer at minimum "승인 / 수정 요청 / 중단". Until approval, steps 4–6 run nothing.
If no `template` remote exists yet, also ask for the template repository URL **once** in this same turn — the same one-time URL rule as `/template-update`; after registration future syncs need no URL.

## 4. Back up the old settings into docs/legacy/ (백업)
Runs **before** the install — the checkout in step 5 would otherwise clobber the old `CLAUDE.md` and `.claude/` files before they can be archived. Delegate to implementer:
- **Exclude personal/local config files from the move set first.** `.claude/settings.local.json`, `CLAUDE.local.md` and other `*.local.*` files are never moved into `docs/legacy/` — they stay at their original paths. A directory-level `git mv .claude docs/legacy/dot-claude` drags the **untracked** files inside along to the new path, and the ignore line step 5 appends (`.claude/settings.local.json`) is root-anchored, so it cannot block the moved copy — `git add -A` then stages it for commit (실측 재현됨). If the directory must move as a whole, `mv` the personal files out to a path outside the move set first and put them back at their original location afterwards (after step 5 recreates `.claude/`); then confirm with `git add -A --dry-run` that no `*.local.*` path appears in the add set.
- `git mv` (tracked files) / `mv` (untracked) into `docs/legacy/`: old `CLAUDE.md` → `docs/legacy/CLAUDE.md`, old `.claude/` → `docs/legacy/dot-claude/`, `AGENTS.md`, `.cursorrules` and friends — everything step 5 replaces plus every rule file step 2 read that stops being authoritative.
- ⚠️ If any old settings file contains secrets/tokens (e.g. keys inside an old local settings file), **do not move it into a committed path** — leave it where it is, tell the user, and exclude it from the commit. Committing secrets is `[금지]`.

### ⚠️ 가져온 내용의 비밀·개인정보 점검
- `/import`는 외부 저장소의 설정·규칙 문서를 그대로 옮겨오므로 API 키·토큰·비밀번호·개인정보(이름·이메일·사번)·사내 절대경로·내부 호스트명이 섞여 들어올 수 있다.
- 2단계 explorer 요약과 6단계에 옮겨 적을 본문은 **커밋 전에 사람이 한 번 훑는다**. 특히 옛 local settings·환경변수 예시·CI 설정 인용부가 위험하다.
- secret으로 보이는 값은 **커밋하지 않는다**(`[금지]`). 해당 파일은 `docs/legacy/`로 옮기지 말고 원위치에 두고 사용자에게 알린다 — 4단계 규칙과 동일하다.
- 이미 커밋·push된 뒤에 발견하면 파일 수정만으로 끝나지 않는다 — 사용자에게 **키 회전 필요**를 함께 알린다.
- 내 머신 전용 절대경로·OS 전용 명령은 지식 파일이 아니라 `docs/MACHINE.md`(git 미추적) 자리다.

## 5. Install the template machinery (교체)
Reuse `/template-update`'s transport — the same remote + per-path checkout (`scripts/template-update.sh` itself arrives with this install, so **future** syncs are just `/template-update` with the remote already registered):
```
git remote add template <템플릿 저장소 URL>   # step 3에서 받은 URL, 이미 있으면 생략
git fetch --no-tags template
git rev-parse --short template/main            # 실패하면 URL/기본 브랜치 오류 — 중단
git checkout template/main -- CLAUDE.md SETUP.md scripts .claude/agents .claude/skills .claude/output-styles .claude/conventions .claude/settings.json
```
- **Never checkout `.claude` wholesale and never bring `.claude/template-origin`** — the sentinel would flip this repo into SETUP-PENDING at every session start. An imported repo is already an initialized project: no sentinel = PROJECT mode, which is exactly right.
- One-time initial copies **only where the project has no file at that path** (project-owned afterwards, exactly like clone time): `.mcp.json`, `.github/` files, `docs/MACHINE.md.example`. Never overwrite the project's existing CI, MCP config, or issue templates.
- Append the ignore lines the machinery needs to the project's `.gitignore` **if missing** (do not replace the file): `.claude/settings.local.json`, `.claude/worktrees/`, `.claude/review/`, `.claude/perf/`, `docs/MACHINE.md`, `CLAUDE.local.md`.

## 6. Migrate the absorbed knowledge (이관)
Delegate to implementer with the full text in the prompt:
- **`docs/PROJECT-RULES.md`** — the imported rules/conventions from bucket 1. This file is project-owned and never synced, so the old rules survive every future `/template-update`.
- **`docs/GOTCHAS.md`** — check first whether the file already exists (`[ -e docs/GOTCHAS.md ]`). **Never overwrite it silently**: at this point the working tree is already dirty from the step 5 checkout, so the step 1 clean-tree safety net protects nothing anymore, and a bare `git checkout template/main -- docs/GOTCHAS.md` clobbers the existing file without warning (실측 재현됨).
  - If it does **not** exist: fetch the template's bundled copy — `git checkout template/main -- docs/GOTCHAS.md` (`docs/` is not in the step 5 list, so fetch it explicitly).
  - If it **does** exist: back the original up first — `cp docs/GOTCHAS.md docs/legacy/GOTCHAS.md` (the step 4 archive dir) — then run the checkout, and merge the backed-up entries into the new file together with the bucket-3 entries below. The original content must survive, in the merged file or in `docs/legacy/`.
  - Then append the imported bucket-3 entries **after** the template's bundled entries, matching the file's entry format and respecting its 20-entry/100-line cap.
- **`docs/STATE.md`** — `/handoff` format: 프로젝트 한 줄 요약, 현재 상태 = imported in-progress state + "이 저장소는 /import로 템플릿 시스템에 편입됨", 다음 할 일 = imported todo items. Include one line: **이전 설정 원본은 `docs/legacy/`에 보관되어 있다.**
- `README.md` is project-owned — untouched.

## 7. Commit & report
- **Pre-commit personal-file check** — right before committing, run `git status --short` and confirm that no personal/local file is staged: `settings.local.json`, `CLAUDE.local.md`, any `*.local.*`, and anything flagged as secret-bearing in step 4 — **including copies under `docs/legacy/`** (the ignore rules do not cover that path). If one is staged, unstage it with `git restore --staged <path>`, move it back to its original location if step 4 carried it along, and only then commit. Committing secrets is `[금지]`.
- Single commit for the whole conversion, e.g. `chore: /import — 템플릿 시스템 편입 (기존 설정은 docs/legacy/ 보관)`. Push follows the normal push rules (not automatic here).
- Report (Korean): changed files; where the old settings live (`docs/legacy/`); source code untouched; settings/hooks take effect only after a **Claude restart**; from now on template sync is `/template-update` (remote already registered).
