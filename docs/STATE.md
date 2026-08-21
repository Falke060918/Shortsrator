# STATE — 마지막 갱신: 2026-08-21

## 프로젝트
Shortsrator — 테마 기반 유튜브 숏츠 반자동 제작 로컬 웹앱 (기획: docs/01-plan.md, 목표: docs/02-goals.md, 기술설계: docs/03-architecture.md)

## 현재 상태
M2(MVP) 완료 — /architect 승인 후 이슈 #1~#10 전부 구현·검증·머지·클로즈, GitHub CI 그린.
- 모노레포(server/web/shared, Fastify+Vite/React+node:sqlite), 어댑터 4종+MANUAL, 테마 프리셋, ffmpeg 9:16 조립, 상태머신+게이트 불가침, REST+SSE, UI 4화면(fixture)
- 판테온 15초 5컷 파일럿 E2E 완주 — REQ-PILOT-01 달성 (MANUAL·목 경로, 외부 네트워크 0)
- 실 API 키는 아직 미투입 — MANUAL 모드만 실동 확인됨

## 다음 할 일 (우선순위 순)
1. API 키 발급·투입(.env — HF_API_KEY_ID/SECRET, ANTHROPIC_API_KEY, ELEVENLABS/TYPECAST) 후 frames 지원 스모크 실행(server/scripts/higgsfield-frames-smoke.ts) → start_end_video 경로 확정, motion-map.ts의 motion_id 자리표시 실값 교체
2. 실 API 모드로 파일럿 1회 실측 — 편당 비용 확인(추산 1.8~2.9만원 vs 목표 3~5천원), dop 티어·컷당 생성 횟수 조정
3. 웹 UI↔실서버 연동 스모크(웹은 fixture로만 검증됨)
4. 후속 후보: 자막·BGM(범위 제외분), Kling 폴백, YouTube 업로드(P2)

## 이번 세션 특이사항
- low 잔여(실키 파일럿 때 재평가): SSE job_progress가 DB 상태보다 선발행(wired-pipeline.ts) / manual 스테이징 파일 잔존(manual.ts) / 서버 재시작 시 MANUAL 대기 잡은 failed 처리(재개는 게이트 반려 경로)
- 실 API의 medias[].url이 로컬 경로를 받는지 미확인 — 스모크 때 판정(미지원이면 업로드/서빙 단계 필요)
- GOTCHA 후보 3건 미등재 보류: curl 순회검증 --path-as-is / CLAUDE_SCRATCHPAD 미정의 / 로컬 그린≠CI 그린(ffmpeg)
