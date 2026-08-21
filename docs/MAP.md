# MAP — 코드베이스 구조·명령 캐시

확인일: 2026-08-21

## 모노레포 구조 (npm workspaces)
루트 `package.json`의 workspaces: `shared` / `server` / `web`. Node >= 24, ESM(`"type": "module"`).

| 경로 | 역할 |
| --- | --- |
| `shared/src/` | 워크스페이스 공용 타입·도메인 — `domain.ts`, `dto.ts`, `adapters.ts`(어댑터 인터페이스), `index.ts` |
| `server/src/` | Fastify 서버 — `app.ts` 진입점(127.0.0.1:8787, DB 오픈·마이그레이션·multipart·web/dist 서빙 조립) |
| `server/src/routes/` | REST+SSE 라우트 — `index.ts`(registerApiRoutes+`/media` 정적), `episodes.ts`, `state.ts`, `shots.ts`, `manual.ts`(드롭 업로드), `settings.ts`, `pipeline-service.ts`(PipelineService 주입 계약 — 실배선은 #10) |
| `server/src/db/` | SQLite 계층 — `db.ts`(node:sqlite 격리 래퍼), `migrate.ts`, `dao.ts`, `migrations/` |
| `server/src/adapters/` | 미디어 생성 어댑터 계층 (아래 상세) |
| `server/src/media/` | ffmpeg 조립 — `assemble.ts`, `probe.ts`, `ffmpeg.ts` |
| `server/src/theme/` | 테마 프리셋 로더 — `loader.ts`, `schema.ts`, `prompt-builder.ts` |
| `server/scripts/` | 단발 실행 스크립트 (스모크 등) |
| `web/src/` | Vite/React UI — `main.tsx`, `App.tsx`, `lib/utils.ts` |
| `scripts/` | 템플릿/저장소 관리 스크립트 (제품 코드 아님) |

## server/src/adapters/ 구조
- `higgsfield/` — **공용 벤더 클라이언트**: `client.ts`(Higgsfield API 호출), `job-adapter-base.ts`(잡 제출→폴링 공통 베이스). image/video 어댑터가 공유한다.
- `image/` — `higgsfield-image-adapter.ts`: Higgsfield 이미지 생성 어댑터
- `video/` — `higgsfield-video-adapter.ts`, `start-end-chain.ts`(시작/끝 프레임 체인), `motion-map.ts`
- `manual/` — `manual-base.ts`, `manual-adapters.ts`: 수동(MANUAL) 폴백 어댑터
- 테스트는 각 소스 옆 `*.test.ts` 동거 배치 (vitest)

## 명령
루트에서 실행:
- 개발: `npm run dev` (server+web concurrently) / 프로덕션: `npm run start`
- 4축 검증: `npm run test`(vitest) / `npm run lint`(eslint) / `npm run typecheck`(워크스페이스별 tsc --noEmit) / `npm run build`(typecheck + web vite build)
- Higgsfield 시작/끝 프레임 스모크: `npx tsx server/scripts/higgsfield-frames-smoke.ts --start <URL> --end <URL>`

## 컨벤션
- 설정 루트 단일화: `eslint.config.js` / `vitest.config.ts` / `tsconfig.base.json`(각 워크스페이스 tsconfig가 extends)
- 서버는 빌드 없이 `tsx`로 직접 실행
