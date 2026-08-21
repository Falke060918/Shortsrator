# Shortsrator

테마 규칙 기반으로 유튜브 숏츠 1편을 로컬에서 반자동 제작하는 개인용 웹앱.
파이프라인이 대본 → TTS → 첫 프레임 → 클립 → 조립을 자동으로 진행하고, 사람은 컨펌 게이트 4곳(대본·첫 프레임·클립·최종)에서만 개입한다.

## 목표와 범위

최종 목표: 컨펌 게이트 4곳에서만 개입해 숏츠 1편을 로컬에서 반자동 생산하는 파이프라인 완성 (`docs/02-goals.md`).

성공 기준 (MVP):

- 파일럿 "판테온 돔" 15초 5컷 1편이 게이트 4개를 모두 거쳐 최종 mp4로 완주 (REQ-PILOT-01)
- 모든 컷 길이가 문장별 TTS 실측 오디오 길이와 일치 — 싱크 어긋남 0건 (REQ-TTS-01, REQ-ASM-01)
- 이미지·영상 생성은 Higgsfield API 자동 호출 + 설정 전환만으로 MANUAL 어댑터(지시서 출력 + 파일 드롭) 폴백 (REQ-ADAPT-01)
- 전 단계 프롬프트에 "신비한 건축" 테마 규칙 자동 주입 (REQ-THEME-01)
- 편당 사람 개입 시간 60분 이내

범위 외: 수익화·시장조사, 클라우드 배포, (MVP 기준) 자막·BGM/SFX·유튜브 업로드 연동 — 업로드는 완주 후 P2.

## 기술 스택

- **런타임**: Node.js ≥ 24, TypeScript, npm workspaces 모노레포
- **서버**: Fastify — 127.0.0.1 전용 로컬 앱, SSE로 잡 진행 알림
- **웹**: Vite + React + Tailwind CSS v4 + shadcn/ui
- **DB**: SQLite (`node:sqlite` 내장, 단일 래퍼 모듈로 격리)
- **미디어**: ffmpeg (조립·길이 실측 — PATH에 있어야 함)
- **생성 어댑터**: Claude API(대본) · ElevenLabs/Typecast(TTS) · Higgsfield(이미지/영상) · MANUAL(전 단계 폴백)

상세 설계와 결정 이유는 `docs/03-architecture.md`.

## 로컬 실행

요구 사항: Node 24+, ffmpeg(PATH), npm.

```bash
npm install
cp .env.example .env   # 쓰는 벤더의 API 키만 채운다

npm run dev            # 개발: Fastify(127.0.0.1:8787) + Vite HMR(localhost:5173, /api 프록시)
npm start              # 상시: web 빌드 후 단일 프로세스 http://127.0.0.1:8787
```

검증 명령:

```bash
npm run build          # 전체 타입체크 + web 프로덕션 빌드
npm run lint           # ESLint
npm run typecheck      # 패키지별 tsc --noEmit
npm test               # vitest
```

로컬 1인용 앱이라 서버는 127.0.0.1에만 바인딩되고 자체 인증이 없다. API 키는 `.env`에만 두고 브라우저로 전송되지 않는다.

## 프로젝트 구조

```
shared/     도메인 타입(에피소드 상태머신·샷 스펙), 어댑터 인터페이스 4종, API DTO
server/     Fastify 서버 (src/app.ts 부팅 — 라우트·파이프라인·DB는 후속 구현 단위)
web/        Vite + React UI (셸 + 폰트·디자인 토큰 세팅)
workspace/  생성 산출물 파일 계층 (gitignore — DB는 메타만, 파일이 원천)
mockup/     킥오프 목업 (대시보드/파이프라인 진행/컨펌 게이트)
docs/       기획·설계 문서 (01-plan, 02-goals, 03-architecture, 원본 명세 3종)
```

구현 단위 분해와 머지 순서는 `docs/03-architecture.md`의 "병렬 구현 단위" 표를 따른다.
