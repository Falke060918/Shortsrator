# STATE — 마지막 갱신: 2026-08-21

## 프로젝트
Shortsrator — 테마 기반 유튜브 숏츠 반자동 제작 로컬 웹앱. 기획 원본은 docs/01_솔루션_개발명세.md·02_제작방법론_소스정리.md·03_테마명세_신비한건축사전.md.

## 현재 상태
킥오프 완료 — 기획서(docs/01-plan.md)·목표(docs/02-goals.md)·목업(mockup/index.html, 3화면: 대시보드/파이프라인 진행/컨펌 게이트) 사용자 승인됨. 목업 승인은 화면·UX 승인일 뿐, 기술 스택·데이터 모델은 미승인.

## 결정 사항
- 개인용(수익화·시장조사 제외), MVP = P1 코어 파이프라인 + Higgsfield API 자동 연동(MANUAL 폴백 유지), 빨리 완주 우선
- 스택 기본값: TS/Node + SQLite + ffmpeg (문서 권장안, /architect에서 세부 확정), TTS는 /architect에서 결정
- MVP 완료 기준: 판테온 15초 5컷 파일럿 완주 (REQ-PILOT-01)

## 다음 할 일 (우선순위 순)
1. /architect — 기술설계 승인(어댑터 레이어·TTS 선택·프레임워크), 스캐폴딩, REQ ID와 이슈 연결
2. 구현: P1 파이프라인 (REQ-THEME/SCRIPT/TTS/FRAME/VIDEO/ASM-01)
