# VERIFY-REPORT — 런타임 실검증 4종 (2026-08-20)

대상: 훅 4종 · bash 허용 8종 · `/import` 스킬 · 파생 저장소 통합(`template-update.sh` 2회).
항목 1은 이번에 실행한 결과, 항목 2~4는 앞선 검증 결과 요약이다. 저장소 파일은 수정하지 않았다(순수 검증).

## 1. 훅 4종 — 실동작 검증 (이번 실행)

- **무엇을 어떻게**: `.claude/settings.json`의 `hooks`를 읽기만 하고(편집 금지), 정의된 훅 4종을 이벤트 JSON을 stdin으로 파이프해 직접 실행. 인라인 SessionStart 훅은 JSON에서 명령 문자열을 파일로 추출해 원문 그대로 bash 실행. 마커 분기는 임시 디렉터리 픽스처 10종으로, 배너는 모드 4종으로 각각 재현.
- **실제 결과**: 4종 전부 기대대로 동작하고 exit 0(guard의 의도적 차단만 exit 2). 총 30여 케이스 전부 기대치와 일치.
- **훅 구성 정정**: 이 저장소 `.claude/settings.json`의 훅은 **AskUserQuestion 가드 / perf-log / SessionStart 3종**이고, rtk 재작성 훅은 저장소 것이 아니라 **사용자 전역 `~/.claude/settings.json`의 `PreToolUse[matcher:Bash] → rtk hook claude`**다.
- **기대와 다른 점**: 저장소 훅에는 어긋난 동작이 없다. 전역 rtk 훅에서 심각한 문제 1건(아래 표 5행). **`-uf` 우회는 경로가 둘이다** — `rtk hook claude`는 `--force`/`-f`를 force로 인식해 재작성만 하고 `permissionDecision`을 **일부러 빼서** settings.json의 ask를 살려두는데, `git push -uf`는 force로 인식되지 않아 재작성과 함께 `"permissionDecision":"allow"`가 붙어 나가고 **훅이 낸 allow는 ask보다 우선하므로**, 항목 2의 옵션 묶음 패턴 공백과는 독립된 두 번째 우회 경로가 된다(막을 수 있는 건 `deny`뿐).

| 훅 | 입력 | 결과 |
| --- | --- | --- |
| `askuserquestion-guard.sh` | 정상 한글 / 이중 백슬래시 `안` / U+FFFD 원바이트 / U+FFFD 이스케이프 표기 / 깨진 UTF-8 / 빈 입력 / `A` / 자모·호환자모 / 126KB 한글 | 9/9 정확. 손상 3종(U+FFFD / 한글 범위 리터럴 `\uXXXX` 잔재 / 깨진 UTF-8)이 **각각 다른 사유 문구**와 함께 exit 2, 정상 입력·빈 stdin exit 0. `iconv`·GNU grep 3.0이 이 머신에 있어 1번 검사가 실제로 동작. 126KB 177ms |
| `perf-log.sh` | PreToolUse·PostToolUse·SubagentStart·SubagentStop·`{}`·빈 stdin | 6/6 exit 0. 컴팩트 JSON에서 필드 추출 정상 → `<root>/.claude/perf/<sid>.jsonl` + `.claude/perf/.gitignore`(`*`) 자동 생성, `session_id` 새니타이즈, `tool_input` 안 미끼 `session_id` 무시. 쓰레기 입력·스크립트 부재·`CLAUDE_PROJECT_DIR` 미설정 전부 exit 0(도구를 막지 않음). 실 로그의 `"agent":"general-purpose"`로 서브에이전트 귀속도 실동작 확인 |
| SessionStart 인라인 마커 | 실제 저장소 + 픽스처 10종 | 실저장소에서 `rtk 0.44.0` + `TEMPLATE-REPO` 정확 출력. 샌드박스에서 MAP-STALE(날짜 없음/50일/**14일 경계 포함**)·KB-OVER-LIMIT(STATE 151·GOTCHAS 101)·ARCHITECT-PENDING·`PROJECT-REPO SETUP-PENDING`(remote 유·무 양쪽)·ASK-MODE 전부 정확히 발화. 경계값(13일, **STATE 정확히 150줄**)에서는 침묵 |
| `session-banner.sh` | 이 워크트리 + 모드 픽스처 4종 | 단일행 유효 JSON(2051B), ANSI 없음. TEMPLATE 모드에서 owner를 remote로부터 런타임 도출, STATE.md "다음 할 일" **상위 2건**을 90바이트 멀티바이트 안전 절단해 반영, `ORCA_TERMINAL_HANDLE`이 있을 때만 `ORCA-ENV`, **`additionalContext`에 `ORCA-CHILD`를 정확히 실음**(연결 워크트리 감지), `03-architecture.md` 생성 시 ⚠줄 소멸 |
| (전역) `rtk hook claude` | `git status` / `rtk git status` / Read / `git push --force` / `-f` / `-uf` / `rm -rf` / `git reset --hard` | 재작성 정상(`git status`→`rtk git status`), 이중 래핑 없음, 비-Bash 무시. **`git push -uf origin main`만 재작성과 함께 `permissionDecision:"allow"`를 내어 settings.json ask 22종을 훅 단계에서 건너뛴다** — `--force`/`-f`는 allow를 안 내므로 ask가 살아 있다 |

- **미검증**: `SubagentStart`/`SubagentStop`은 스크립트 단독 실행만 검증했다 — Claude Code가 그 이벤트를 실제로 발화하는지는 확인 못 했다(이번 세션 로그 99줄에 Pre/PostToolUse만 존재).
- **부수 관측**: SessionStart 훅 3개 합계 약 0.9초(마커 훅 386ms, 배너 471ms) — 예산 여유는 있으나 세션 시작 체감 지연의 대부분이 여기다. 그리고 마커 훅 성공 경로가 `rtk 0.44.0` 한 줄을 매 세션 모델 컨텍스트에 남긴다.

## 2. bash 허용 8종 (완료됨, 정적 대조 — 위험 명령 미실행)

- **무엇을 어떻게**: allow/ask/deny를 8계열로 묶어 래퍼 접두사·`-f` 축약·인자 순서·연결자·인터프리터 우회를 손대조.
- **실제 결과**: 래퍼 축은 닫혀 있다 — `rtk git push --force`, `rtk proxy …`, `timeout/nice/nohup/env …`, `git -C /path push --force`, 인자 순서 교체, `+` refspec, `--force-with-lease` 전부 `Bash(* git push *--force*)`/`Bash(* push *--force*)`에 걸린다(GOTCHAS의 "래퍼 접두사 우회" 교훈 반영됨).
- **기대와 다른 점**: 7건이 뚫린다 — ① `git push -uf origin main`(`-qf`/`-vf`/`-nf` 포함): `-f`가 옵션 묶음 첫 글자가 아니면 ask 22종을 전부 빠져나가 `Bash(git push:*)`로 조용히 통과(**항목 1에서 런타임으로도 재확인**) ② `Bash(python:*)`/`node`/`npx`/`npm run`/`rtk:*` 임의 실행기 allow가 자식 argv를 감춰 ask·deny 전 계층 무력화(설정 파일 deny, `.env`/`*.pem` Read deny 포함) ③ `Bash(rtk:*)`가 allow에서 일부러 뺀 `git reset --hard`·`git clean -fdx`를 되돌려 엶 ④ `base64 *`+`cut *`+`tr *`+`openssl s_client *` 무제한 꼬리 조합 ⑤ 연결자·명령치환(`;`, `$( )`)은 설정만으로 판정 불가하고 설정 자체에 방어 없음 ⑥ 하드 규칙 3은 force push를 `[금지]`라 하는데 실제 설정은 ask뿐이고 deny에 Bash 항목 0개 ⑦ 저심각: `Bash(gh auth status)`가 완전일치라 `--active`는 프롬프트, `Bash(git checkout:*)`/`stash:*`/`branch:*`가 무커밋 작업 파괴를 허용.

## 3. `/import` 스킬 (완료됨, 임시 디렉터리 실행)

- **무엇을 어떻게**: 임시 디렉터리에 template 원격 클론 + 더미 standalone 저장소(옛 CLAUDE.md, 가짜 키가 든 `settings.local.json` 포함 `.claude/`, AGENTS.md, .cursorrules)를 만들고 SKILL.md 1~7단계를 Git Bash로 실제 실행.
- **실제 결과**: 명령 자체는 Windows 포함 전부 동작. 사후 `session-banner.sh`가 "모드: 프로젝트 (초기화 완료)"를 내고 이어진 `template-update.sh`도 정상.
- **기대와 다른 점**: 어긋나는 것은 안전장치 쪽이고 2건이 실사고로 재현됐다 — ① **[심각·실측]** 4단계 `git mv .claude docs/legacy/dot-claude/`가 미추적 secret(`settings.local.json`)까지 커밋 경로로 끌고 간다. 5단계가 넣는 ignore 줄 `.claude/settings.local.json`은 슬래시 때문에 루트 앵커라 새 경로를 못 막고 `git add -A`에 잡힌다 ② **[실측]** 6단계 `git checkout template/main -- docs/GOTCHAS.md`가 기존 GOTCHAS를 경고 없이 덮어쓴다. 이 시점 워킹트리는 5단계 checkout으로 이미 더러워 1단계 clean-tree 안전망이 무효이고, 5단계의 `.mcp.json`/`.github/`에는 "없을 때만" 방어가 있는데 6단계엔 빠져 있다(비대칭) ③ `docs/PROJECT-RULES.md`가 5단계에 없어 6단계 중단 시 CLAUDE.md의 import 3개가 깨진 저장소가 남는다 ④ 5단계가 가져오는 `SETUP.md`가 import 저장소엔 부적합(센티넬 없음, README 링크가 자기 README를 가리킴)인데 "무시해도 된다" 안내가 없다 ⑤ 4단계 백업 목록에 `CLAUDE.local.md`가 없다 ⑥ 5단계 `.gitignore` 덧붙이기에 중복 판정이 없다 ⑦ `template` remote 이름이 이미 점유된 경우 처리가 없다.

## 4. 파생 저장소 통합 + `template-update.sh` 2회 (완료됨, 임시 디렉터리)

- **무엇을 어떻게**: 원본을 `--no-hardlinks` 클론 → 옛 커밋 `2843704`로 리셋(당시 배열: conventions 없음/스킬 5종 개별 나열/`ci.yml` 포함) → SETUP 1번대로 파생화(`template-origin` 삭제, MAP 제거, CLAUDE.md·ci.yml에 고유 마커) → `template` remote 등록 → `template-update.sh` 2회(대상 `template/main @ a0b401b`).
- **실제 결과**: **2회차 지연이 정확히 재현**(두 회차 모두 exit 0). 1회차 — `.claude/conventions/` 미생성, 새 스킬 4종+webapp-testing 미전파, 배열에서 빠진 `ci.yml`이 마지막으로 한 번 더 덮어써져 CI 마커 소실, 백업/diff 가드 미동작(`.template-update-backup/` 미생성)으로 CLAUDE.md 하단 마커가 **백업 없이** 소실. 2회차 — conventions 4파일+새 스킬 4종+webapp-testing 반영, `ci.yml` 무변경(마커 생존), CLAUDE.md는 diff 출력과 함께 백업, settings.json은 `동일`로 건너뜀. diff 요지는 1회차 23개 스테이징(M 19/A 4, 그중 원치 않는 `ci.yml` 클로버 1), 2회차 15개(A 14/M 1, 수정은 CLAUDE.md뿐).
- **기대와 다른 점**: 문서와 어긋난 동작은 없다. 문서에 없는 사실 1건 — 템플릿에서 **삭제된** 스킬(`release`)은 1회차에 `skip (템플릿에 없음)`만 찍고 2회차에도 파생본에 잔존한다. checkout 기반이라 삭제는 절대 전파되지 않는다.

## GOTCHA 후보

- **force-push 차단 패턴은 `-f`가 옵션 묶음 첫 글자일 때만 걸린다** (`git push -fu`는 확인, `git push -uf`는 조용히 통과). 회피: 플래그 패턴을 `* push *-*f*` 형태로 쓰고 새 패턴은 `-f`를 첫/중간/끝 세 자리로 대조. 근본적으로 `python`/`node`/`rtk` 실행기 allow가 있는 한 argv 패턴 차단엔 상한이 있으니 최후 방어선으로 취급하지 말 것.
- **PreToolUse 훅이 내는 `permissionDecision:"allow"`는 settings.json의 ask를 통째로 건너뛴다.** 실측: 전역 `rtk hook claude`가 `git push -uf origin main`을 재작성하면서 allow를 함께 냈다(`--force`/`-f`는 allow 없이 재작성만 하므로 ask 생존). 즉 위 `-uf` 구멍은 패턴 미스매치 하나가 아니라 **훅이 능동적으로 허가하는** 두 번째 경로가 겹친 것이다. 훅이 위험 변형을 인식 못 하면 그 자리에서 allow가 나가버리므로 **ask 목록을 방어선으로 믿으면 안 된다** — 회피는 `deny`뿐이다.
- **디렉터리 단위 `git mv`는 안의 미추적 secret 파일까지 커밋 경로로 함께 옮긴다.** 루트 앵커 ignore 규칙(`.claude/settings.local.json`)은 새 경로를 못 막는다. 회피: 옮기기 전에 `*.local.*`류를 빼내고 `git add -A --dry-run`으로 확인.
- **템플릿 파일을 `git checkout <remote>/main -- <path>`로 가져오면 프로젝트의 동명 파일이 경고 없이 사라진다** (`/import` 6단계는 clean-tree 안전망도 이미 무효). 회피: `[ -e "$p" ]` 확인 후 원본 보존·병합.
- **템플릿에서 삭제된 스킬·스크립트는 파생 프로젝트에서 영원히 사라지지 않는다** (checkout 기반이라 삭제 미전파, `release` 스킬 잔존 실측). 회피: 제거·개명 시 릴리즈 노트에 수동 `rm -rf`를 명시.
- **첫 `/template-update`에는 CLAUDE.md 백업이 존재하지 않는다** (백업 가드 자체가 새 스크립트 기능). 회피: 1회차 전 전량 커밋이 유일한 안전망. 프로젝트 규칙을 `docs/PROJECT-RULES.md`에 두면 이 실패가 애초에 없다.
- **훅 검증용 JSON 픽스처를 `json.dumps` 기본값으로 만들면 훅이 조용히 아무것도 못 뽑는다** — `perf-log.sh`·`fanout.sh`의 `grep -o '"key":"'`는 공백 없는 컴팩트 JSON 전제라 `"key": "value"`면 전 필드가 빈 문자열이 되고 `unknown.jsonl`이 생긴다. 실동작 버그가 아니라 **검증이 거짓 실패로 보이는** 함정. 회피: `separators=(',',':')`.
- **훅 래퍼는 `CLAUDE_PROJECT_DIR`가 저장소를 안 가리키면 조용히 exit 0으로 넘어간다** — `[ -f "$s" ] && exec bash "$s"; exit 0` 구조라 스크립트를 못 찾아도 에러도 로그도 없어, AskUserQuestion 가드가 **전혀 안 걸린 상태가 정상 통과처럼 보인다**(이번 검증 중 실제로 오판). 회피: 가드를 의심할 땐 `.claude/perf/`에 로그가 쌓이는지로 훅 도달 여부를 먼저 본다.
- **Git Bash에서 `python`은 MSYS 경로(`/c/...`)를 못 읽는다** — 같은 스크립트에서 bash는 `/c/...`, python은 `C:/...`를 써야 한다. 앞선 bash 단계가 성공해 있어 원인이 경로 형식임이 즉시 안 보인다.
- **Windows Git Bash에서 훅 픽스처의 백슬래시는 한 번 벗겨진다** — 인라인 `printf '...\\\\uc548'`로 만든 "이중 백슬래시" 케이스가 단일 백슬래시로 도착해 guard가 통과시키고, 이를 훅 버그로 오진했다. 파이썬 heredoc에 적은 `"\\uc548"`도 한 겹 벗겨져 파이썬이 진짜 한글 '안'으로 디코드했고, 가드가 통과시키는 걸 보고 결함으로 오판할 뻔했다. 회피: 백슬래시가 의미를 갖는 픽스처는 인라인 대신 파일로 생성(`printf '\134\134'` 또는 python `chr(92)` 연결)하고 `od -c`로 바이트를 확인한 뒤 파이프한다. 같은 이유로 훅 출력 검사용 python은 `PYTHONIOENCODING=utf-8`을 붙인다(기본 cp949가 `✦`·이모지에서 죽는다).
