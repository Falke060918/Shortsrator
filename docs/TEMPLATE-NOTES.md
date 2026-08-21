# TEMPLATE-NOTES — 템플릿 원본 구조 메모

이 저장소(claude-starter, 템플릿 원본)의 파일별 역할·주의점 캐시다. `docs/STATE.md`에 있던 "주요 파일" 섹션을 옮겨온 것이다.
- **`@`로 자동 로드하지 않는다.** STATE.md는 매 세션 메인 컨텍스트에 실리므로 이런 참조 자료를 담으면 모든 세션이 비용을 낸다. 필요한 서브에이전트만 읽는다.
- `docs/MAP.md`가 아닌 이유: MAP은 파생 프로젝트로 동기화될 위험이 있어 이 저장소에 두지 않기로 했다. `docs/`는 `template-update.sh`의 HARD EXCLUSIONS라 이 파일은 파생으로 새지 않는다.
- 절대 경로·머신 전용 명령은 여기가 아니라 `docs/MACHINE.md`(git 미추적)에 적는다.

## 주요 파일
- `CLAUDE.md`: 운영 원칙(한국어). 마커 6종/자동 kickoff/handoff→clear/push 일괄/분해 의무화/폰트 기본값/프론트엔드 기본 스택(React면 shadcn/ui 우선 확인 의무). **정리본 질문은 AskUserQuestion 한 호출에 최대 4개 묶음 + `3/7.` 진행 위치 표시, 우선순위 선택 질문은 내지 않는다.** 표준 흐름에 `/land` 포함
- `.mcp.json`: playwright·chrome-devtools MCP 서버. **`template-update.sh`의 HARD EXCLUSIONS** — 파생 프로젝트 소유이며 통짜 동기화 금지
- `.claude/settings.json`: agent 강제, `effortLevel: "medium"`, ask에 push force 패턴군, deny `Read(./.env.*)`, `worktree.baseRef: "head"`, SessionStart 훅 2개 + perf 수집 훅 3개(PreToolUse/PostToolUse/SubagentStop → `scripts/perf-log.sh`, 항상 exit 0) + PreToolUse AskUserQuestion 가드 1개(matcher `AskUserQuestion` → `scripts/askuserquestion-guard.sh`, 인코딩 손상 시그니처면 exit 2 차단), `enableAllProjectMcpServers: true` + allow 32개(`mcp__playwright__*`·`mcp__chrome-devtools__*` 포함). **훅 문자열 ASCII 유지**
- `.claude/agents/*.md`: 5역할(영어). orchestrator 불릿 36개(질문 묶음 규칙 반영으로 증가). reviewer는 MCP 도구 보유 + 브라우저 검증 우선순위 명시. effort: planner/reviewer `max`, implementer/explorer `high`. **model 미지정 = 메인 세션 모델 상속**
- `.claude/skills/{kickoff,architect,land,handoff,template-update,cheatsheet,webapp-testing,perf,import}/SKILL.md`: 9종, 지시부 영어. import는 비파생 저장소 편입(설정 계층만 전환, 코드 무변경, 구설정은 `docs/legacy/` 보관). perf는 세션 병목 리포트(`scripts/perf-report.sh` 위임 실행, jq 필요). handoff·land는 단일 에이전트·단일 커밋. **template-update SKILL은 덮어쓰기 8경로·HARD EXCLUSIONS 7종을 사실대로 기재하고 CLAUDE.md diff 확인 단계를 포함**. webapp-testing만 유일하게 실행 스크립트(`scripts/with_server.py` 등)와 `LICENSE.txt`를 함께 담고 있다
- `.claude/conventions/fonts.md`: 폰트 강제값. `Geist, Pretendard, sans-serif` / `"Geist Mono", D2Coding, monospace`. **OS 기본 폰트 폴백 금지**
- `.claude/conventions/frontend-design.md`: 시각 설계 원칙(anthropics/skills 개작, Apache-2.0). 폰트는 fonts.md 참조로 위임
- `scripts/fanout.sh`: fan-out 폭 + 동시 실행 비율 + 직렬 손실 계측. `bash scripts/fanout.sh [N] [--all] [--gap 초]`. transcript 파싱 함정 3종은 이 파일 헤더가 원본 — perf-report.sh와 지식 공유
- `scripts/perf-report.sh`: 세션 병목 리포트(도구별 상위·스폰→완료·사용자 대기·벽시계 분해). `bash scripts/perf-report.sh [N] [--gap 초]`, jq 필수, 훅 로그 없으면 transcript만으로 degrade
- `scripts/perf-log.sh`: perf 훅 수집기 — 세션별 `.claude/perf/<sid>.jsonl` append, 순수 sh·항상 exit 0, 디렉터리 자체 gitignore 생성
- `scripts/template-update.sh`: 동기화 8경로, HARD EXCLUSIONS 7종(ci.yml·`.mcp.json`·docs/·README.md·settings.local.json·template-origin·제품 코드). **CLAUDE.md·settings.json은 덮어쓰기 전 `.template-update-backup/<UTC>/` 백업 + diff 제시, 백업 실패 시 exit 1**. 검토 명령은 `git diff --cached`(bare `git diff`는 0줄). 백업 폴더 제외는 `.git/info/exclude`
- `scripts/session-banner.sh`: 모드 감지 파싱은 settings 훅 포함 3곳 문자 단위 동기화 필수. 배너가 STATE "다음 할 일" 2줄 출력
- `docs/MACHINE.md.example`: 머신 전용 절대경로·명령 메모 틀(사본은 git 미추적)
- `docs/GOTCHAS.md`: 영어 항목 20개 / 98줄
- `docs/releases/`: 버전별 변경 기록(한국어, 누적). 규칙·노트 형식은 `docs/releases/README.md`(semver 0.x, 노트 1건 상한 60줄), 노트는 `<major>.<minor>.x/<x.y.z>.md`(버전 하위 폴더 필수), 항목은 저장소 전역 고유 코드 `[RN-0001]` + `기존/페인포인트/개선` 3줄. 발행 판단은 `/handoff` 2단계 — 규칙·스킬·훅/설정·`scripts/` 변경 때만. **`docs/`는 HARD EXCLUSIONS라 파생으로 전파되지 않는다 = 템플릿 원본 전용**

## 구조 조사 캐시 (2026-08-21, explorer 97k 토큰 — 재조사 금지)
`/perf` 성능 분석 + 템플릿 구조 개선안 도출은 **미완**이다. 조사는 끝났고 개선안 도출만 남았다.
- 규모: 템플릿 기계장치 4,115줄 중 **자동 로드는 408줄(~15k 토큰)** — CLAUDE.md 136 + STATE 22 + GOTCHAS 99(14.9KB) + PROJECT-RULES 7 + `agents/orchestrator.md` 96 + `output-styles/brief.md` 48. 스크립트 2,001줄(49%)은 모델이 아예 안 읽는다.
- 구조 결함 7: ① CLAUDE.md↔orchestrator.md 요약/상세 분리가 둘 다 항상 로드라 비용을 못 줄이고 규칙 두 벌(~40줄)만 만든다 + 순환 참조 ② `.claude/review/last-verdict.md`가 전역 단일 파일이라 병렬 단위 N개가 서로 덮어쓴다 ③ `/land` SKILL 본문이 Orca를 모르고 `git worktree`만 기술(오버라이드는 orchestrator.md에만) ④ settings.json에 2,600자 인라인 SessionStart 훅(마커 7종+율리우스일 계산)인데 자기 deny로 에이전트가 수정 불가 ⑤ 도구 강제는 오케스트레이터에만 걸려 있고 explorer/reviewer의 읽기 전용은 Bash가 열려 있어 관례일 뿐 ⑥ 오케스트레이터가 Write 불가라 문서 전문이 위임 프롬프트를 통과 — '컨텍스트 덤프 금지'와 정면 충돌 ⑦ GOTCHAS 상한에 줄 수만 있고 바이트 상한이 없다.
- 규칙 모순 7건: push 게이트를 handoff/kickoff가 우회 / STATE.md 소유권이 land↔architect 충돌 / MAP 규칙의 TEMPLATE-REPO 예외가 CLAUDE.md에 누락 등.
- SYNC NOTE 3개(status-protocol·import·session-banner)의 선언 사본 목록은 실측 대조 결과 전부 정확. 단 어느 것도 GOTCHAS를 사본으로 세지 않는데 실제로는 규칙 사본을 겸한다.
