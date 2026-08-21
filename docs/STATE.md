# STATE — 마지막 갱신: 2026-08-21

## 프로젝트
Shortsrator — 테마 기반 유튜브 숏츠 반자동 제작 로컬 웹앱. 기획 원본은 docs/01_솔루션_개발명세.md·02_제작방법론_소스정리.md·03_테마명세_신비한건축사전.md.

## 현재 상태
기술계획 승인 완료 — docs/03-architecture.md 커밋됨(adfaa90). GitHub 모드로 진행: M2 구현 이슈 10건(#1~#10) 생성 완료(라벨 feat·M2). scaffold-core(#1)는 별도 워크트리에서 구현 진행 중.

## 결정 사항
- 개인용(수익화·시장조사 제외), MVP = P1 코어 파이프라인 + Higgsfield API 자동 연동(MANUAL 폴백 유지), 빨리 완주 우선
- 스택 확정(03-architecture): Fastify + Vite/React 2패키지(npm workspaces), SQLite + node:sqlite, TTS는 ElevenLabs·Typecast 듀얼 어댑터, Higgsfield 공식 API + MANUAL 어댑터 4종, 자막·BGM MVP 제외
- MVP 완료 기준: 판테온 15초 5컷 파일럿 완주 (REQ-PILOT-01)

## 다음 할 일 (우선순위 순)
1. #1 scaffold-core: 모노레포 스캐폴딩+CI+제품 README — **별도 워크트리에서 진행 중**
2. 웨이브1 병렬 6개 (#1 머지 후): #2 db-layer / #3 theme-preset / #4 adapter-text / #5 adapter-media / #6 ffmpeg-assembly / #7 web-ui
3. 웨이브2 병렬 2개: #8 pipeline-engine(#2 의존) / #9 api-server(#2·#8 의존)
4. #10 pilot-integration: 판테온 파일럿 완주 E2E (#1~#9 전부 의존)
