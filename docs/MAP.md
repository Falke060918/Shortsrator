# MAP — 코드베이스 구조·명령 캐시

확인일: 2026-08-21

## 모노레포 구조 (npm workspaces)
루트 `package.json`의 workspaces: `shared` / `server` / `web`. Node >= 24, ESM(`"type": "module"`).

| 경로 | 역할 |
| --- | --- |
| `shared/src/` | 워크스페이스 공용 타입·도메인 — `domain.ts`, `dto.ts`, `adapters.ts`(어댑터 인터페이스), `index.ts` |
| `server/src/` | Fastify 서버 — `app.ts` 진입점 |
| `server/src/adapters/` | 미디어 생성 어댑터 계층 (아래 상세) |
| `server/src/db/` | SQLite 래퍼(`db.ts`)·DAO(`dao.ts`)·마이그레이션(`migrate.ts`, `migrations/*.sql`) |
| `server/src/pipeline/` | 상태머신(`state-machine.ts`)·게이트 정책(`gates.ts`)·잡 러너(`job-runner.ts`)·엔진(`engine.ts`)·샷리스트(`shotlist.ts`)·start_end 배선(`start-end.ts`)·비용 집계(`cost.ts`) — 공개 표면은 `index.ts` |
| `server/src/theme/` | 테마 프리셋 로더·프롬프트 빌더 (`presets/*.json`) |
| `server/src/media/` | ffmpeg 조립(`assemble.ts`)·프로브 |
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
