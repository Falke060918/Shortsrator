# 03 — 기술설계 (사용자 승인: 2026-08-21)

## 채택안
- **Fastify + Vite/React 2패키지** — npm workspaces(`server`/`web`/`shared`), 로컬 웹앱(127.0.0.1 고정), Node ≥24, TypeScript.
- **DB: SQLite + node:sqlite(Node 24 내장)** — 설치 0. RC 리스크는 DB 접근을 단일 래퍼 모듈로 격리해 better-sqlite3 교체를 1파일 수정으로 한정.
- **TTS: ElevenLabs·Typecast 둘 다 어댑터로 구현** — 웹 설정에서 벤더 선택(사용자 결정). 컷 길이는 벤더 API가 아니라 문장별 합성 후 로컬 ffprobe 실측(ms)으로 획득 — 벤더 중립.
- **이미지/영상: Higgsfield 공식 API** — `platform.higgsfield.ai`, `Authorization: Key KEY_ID:SECRET`, 비동기 request_id → 폴링(2s), SDK `@higgsfield/client`. T2I `soul`/`flux`, I2V `dop`(motion_id ↔ 테마 카메라 문법 7종 매핑).
- **MANUAL 어댑터 4종 필수** — 지시서 출력 + 파일 드롭. 설정으로 API↔MANUAL 전환(REQ-ADAPT-01).
- **자막·BGM/SFX: MVP 제외** — REQ-ASM-01 그대로 조립+싱크만. 완주 후 후속 단위.
- **GATE3 발췌: 0.1초 단위** — 숫자 입력 + 플레이어 "현재 위치를 in/out으로" 캡처 버튼. 타임라인 드래그 위젯 없음.
- **start_end_video는 시스템 기능** — 샷 스펙에 `transition_type`(`frames|edit_splice|manual`)·`fallback` 필드, 런타임 자동 강등 체인: ① Higgsfield frames(구현 1일차 API 지원 스모크 확인) → ② 편집 이음새(시작·끝 이미지 각각 I2V 2클립 + 플래시/가림 스플라이스, 단순 dissolve 금지) → ③ MANUAL. 외부 Kling(fal.ai) 폴백은 파일럿 완주 후 확장 항목.

## 기각안과 이유
- Next.js 단일: dev 재시작 시 인프로세스 잡 유실, workspace 파일 서빙·SSE 우회적, SSR·클라우드 배포 기능이 이 제품에 불용.
- Hono: multipart·static 지원이 Fastify 대비 부족.
- better-sqlite3: Windows 네이티브 빌드 리스크. 교체 경로만 유지.
- MVP 내 Kling 제2벤더: 키·과금·연동 추가가 "빨리 완주" 결정과 상충 — 후속 확장으로 연기.

## 데이터 모델 — 01_솔루션_개발명세 §8 채택 + 수정 4건
1. `shots` 길이는 **ms 정수**(`duration_ms`, `adopted_in_ms`/`adopted_out_ms`).
2. `jobs` 테이블 신설 `(id, episode_id, shot_id?, kind, adapter, status, request_id?, cost_credits?, cost_krw?, payload_json, error?, created_at, updated_at)` — 비용 추적(§10)·크래시 재개·MANUAL 대기의 원천.
3. `generated_assets.meta_json` 추가(모델·seed·motion_id·사용 프롬프트) — 재현성.
4. `channels`·`uploads`는 P2 마이그레이션으로 연기, `settings` KV 테이블 추가(어댑터 모드·TTS 벤더 선택·예산 한도).
마이그레이션은 번호제 SQL 파일 + 경량 러너. ORM 없음. 산출물은 파일이 원천, DB는 메타만.

## API 계약 (주요 엔드포인트)
```
GET  /api/state                          대시보드 집계(에피소드+대기 게이트+주제 큐)
POST /api/episodes {topicId}             에피소드 생성(TOPIC)
GET  /api/episodes/:id                   상세(샷·후보·게이트 이력·비용)
POST /api/episodes/:id/advance           다음 자동 단계 실행(잡 투입)
POST /api/episodes/:id/gate {gate, decision, payload}   GATE1~4 승인/반려
POST /api/shots/:id/adopt {assetId, inMs, outMs}        GATE3 클립 채택
POST /api/episodes/:id/rollback {toState}
GET  /api/episodes/:id/events            SSE(잡 진행·상태 전이) — 폴백: 상태 폴링
POST /api/manual/:jobId/files            MANUAL 드롭 업로드(multipart)
GET/PUT /api/settings                    어댑터 모드·TTS 벤더·예산·Higgsfield 티어(키 값 자체는 미노출)
PUT  /api/settings/keys                  API 키 기록(쓰기 전용 — .env 반영, 빈 값=삭제, 값 미반환)
GET  /media/*                            workspace 정적 서빙(읽기 전용)
```
게이트 대기는 SSE 1채널(+폴링 폴백). 웹소켓 불사용.

## 보안 경계 (로컬 앱)
- 서버 **127.0.0.1 바인딩 고정**, 앱 자체 인증 없음(1인 로컬).
- API 키 저장소는 `.env`(gitignore) 단일, 모든 벤더 호출은 서버 측. 키 입력은 웹 설정 화면에서도 가능(127.0.0.1 로컬 한정, **쓰기 전용** — `PUT /api/settings/keys`가 `.env`에 기록, 조회는 "설정됨/누락"만, 값 재노출 없음). 기존 "브라우저에 키 미전송" 경계는 2026-08-21 사용자 결정으로 완화(로컬 1인용 전제, issue #11).
- CORS 개방 없음: dev는 Vite 프록시, 상시는 Fastify가 `web/dist` 동일 오리진 서빙.
- `/media` 경로 순회 가드, MANUAL 업로드는 png/jpg/webp/mp4/mov 화이트리스트.

## 실행법
- 요구: Node ≥24, ffmpeg PATH, `.env`(HF_API_KEY_ID/SECRET, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, TYPECAST_API_KEY — 쓰는 벤더만).
- `npm run dev` = Fastify(tsx watch) + Vite HMR(프록시) / `npm start` = web 빌드 후 Fastify 단일 프로세스(http://127.0.0.1:8787). 클라우드 배포 없음.

## 되돌리기 어려운 결정
1. workspace 파일 계층 `workspace/{channel}/{themeVersion}/{episode}/{script|tts|frames|clips|master|final}/`
2. 어댑터 인터페이스(§6 + 비동기 잡 시맨틱스·비용 메타 반환)
3. 에피소드 상태머신 문자열 목록(§2-3)
4. 샷 길이 ms 단위

## 수용한 리스크
- 편당 비용이 목표(3~5천원) 초과 추산(1.8~2.9만원, 크레딧 시세 기준) — 구현 1주차 실측, 컷당 생성 2회 제한·예산 경고를 P1 포함.
- Higgsfield frames·9:16·레퍼런스 입력 API 노출 미확인 — 1일차 스모크로 판정, 폴백 체인 가동.
- node:sqlite RC — 래퍼 격리로 수용.
- TTS 한국어 억양 — 듀얼 벤더 선택으로 완화.

## 병렬 구현 단위 (승인 후 fan-out)
| 단위 | 범위 | 의존 | 관련 REQ |
|---|---|---|---|
| scaffold-core | 루트 설정, shared/src/* 전체, .env.example, CI, README | — | REQ-ADAPT-01(IF) |
| db-layer | server/src/db/* | scaffold-core | 비용 추적 |
| theme-preset | presets/*, server/src/theme/* | scaffold-core | REQ-THEME-01 |
| adapter-text | server/src/adapters/llm/*, tts/*(ElevenLabs+Typecast) | scaffold-core | REQ-SCRIPT-01, REQ-TTS-01 |
| adapter-media | server/src/adapters/image/*, video/*, manual/* | scaffold-core | REQ-FRAME-01, REQ-VIDEO-01, REQ-ADAPT-01 |
| ffmpeg-assembly | server/src/media/* | scaffold-core | REQ-ASM-01 |
| web-ui | web/* 전체(fixture 병행) | scaffold-core(DTO) | 게이트 UI |
| pipeline-engine | server/src/pipeline/* | db-layer+어댑터 IF | 상태머신·게이트 불가침 |
| api-server | server/src/routes/*, server/src/app.ts | db-layer, pipeline IF | SSE·MANUAL 드롭 |
| pilot-integration | 접합·E2E | 전부 | REQ-PILOT-01 |

머지 순서: scaffold-core → 웨이브1 병렬 6개(db-layer·theme-preset·adapter-text·adapter-media·ffmpeg-assembly·web-ui) → 웨이브2 병렬 2개(pipeline-engine·api-server) → pilot-integration.
