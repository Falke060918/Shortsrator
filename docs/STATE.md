# STATE — 마지막 갱신: 2026-08-21

## 프로젝트
Shortsrator — 테마 기반 유튜브 숏츠 반자동 제작 로컬 웹앱 (기획: docs/01-plan.md, 목표: docs/02-goals.md, 기술설계: docs/03-architecture.md)

## 현재 상태
M2(MVP) 완료 후 **실 API 전환 단계**. 이슈 #1~#11 전부 구현·검증·머지·클로즈, CI 그린.
- 실 키 투입: Anthropic·Higgsfield 완료(.env/웹 설정 탭). ElevenLabs/Typecast(TTS)는 **미투입**.
- frames 스모크 완료(07d7231): start_end_video 지원 확인. 단 신 표면 `POST /higgsfield-ai/dop/{lite|standard|turbo}/first-last-frame`(본문 `prompt`/`image_url`/`end_image_url`/`motions:[{id,strength}]`). `medias[].url`은 로컬 경로 미지원(http/https만, 422). 클립 단가 lite $0.125 / turbo $0.407 / standard $0.563, 실패·NSFW는 무과금.
- 실호출 경로 전환 완료(0c79966, 검증 pass b9239c3): startEnd 신 표면 전환, 프리사인 업로드(`/files/generate-upload-url` → PUT → public_url) 추가, 상태 조회 구 표면 우선 + 404/405 시 `/requests/{id}/status` 폴백·경로 기억, 설정 티어→벤더 티어 매핑, resolveMotionId를 배열 순서 → 프롬프트 등장 위치 기준으로 교정(매칭 1/7 → 7/7), motion_id 7종 실 UUID화. vitest 202/202, tsc 3워크스페이스 클린.
- 웹↔실서버 연동 스모크 통과: 화면 4개+설정 탭 모두 실서버 REST/SSE 정상(에피소드 생성 201, 상태 진행 200, SSE 상태변경 수신), 콘솔·네트워크 에러 0 — 코드 수정 불필요.

## 다음 할 일 (우선순위 순)
1. **[실키 파일럿 전 필수] i2v 경로도 신 표면으로 전환** — `server/src/adapters/video/higgsfield-video-adapter.ts:68`의 `i2v()`가 아직 구 표면 `/v1/image2video/{model}`에 `medias[]`+로컬 경로+`motion_prompt`/`duration_sec`/`motion_id`를 보낸다. 실측 스키마는 `{params:{prompt,input_images,motions,model}}`이고 로컬 경로는 422. 파일럿 5컷 중 **4컷이 i2v**(`presets/mysterious-architecture.json` pilot_template idx 0,1,2,4)라 지금 돌리면 첫 컷에서 깨진다.
2. **실 API 파일럿 1회 실측** — 첫 회는 **lite 티어로** 시작(설정 기본값 '표준'은 벤더 turbo=$0.407/클립, lite의 3.3배. 5컷 영상만 turbo ≈2,900원 vs lite ≈900원). 실행 시 응답 본문에 `credits` 필드가 있는지 반드시 확인 — 없으면 `jobs.cost_*`가 null이 되어 예산 경고가 영구히 안 뜬다(`server/src/adapters/higgsfield/job-adapter-base.ts:107`).
3. TTS 키(ElevenLabs/Typecast) 투입 — 미투입 시 음성 단계는 수동 처리.
4. 리뷰어 지적 후속 — `start-end-chain.ts:70`이 startEnd의 **모든** 예외를 'frames 미지원'으로 강등해 401/403(키 오류)·ENOENT까지 조용히 manual로 내려간다(401/403은 강등 제외) / `adapter-set.ts:155` DOP_TIER_BY_SETTING 매핑 테스트 없음 / `client.ts:123` v2StatusIds Set 미해제(경미) / `motion-map.ts:60`이 등장 위치 기준이라 향후 START_END 프롬프트를 buildMotionPrompt로 바꾸면 장면 묘사가 카메라 무빙을 가로챈다 / 티어별 클립 단가가 설정 UI에 미표시.
5. `/perf` 성능 분석 + 템플릿 구조 개선안 도출(사용자 요청, **미완**) — 구조 조사는 이미 끝났다. 요지는 `docs/TEMPLATE-NOTES.md`의 "구조 조사 캐시"에 있으니 **재조사하지 말고 개선안 도출부터** 시작한다.
6. 후속 후보: 자막·BGM(범위 제외분), Kling 폴백, YouTube 업로드(P2).

## 이번 세션 특이사항
- `settings-ui/` 빈 디렉터리는 다른 프로세스가 점유해 삭제 불가 — 손대지 말 것.
- `.playwright-mcp/`는 웹 스모크 증거(smoke-report.json + 스크린샷 2장) 보존용 미추적 폴더다. **삭제 금지**, .gitignore에 등재함.
- 미병합 브랜치 `Falke060918/architect-explore`(architect 사전조사 리포트, main에 없음) 유지 — 삭제하지 말 것.
- low 잔여(실키 파일럿 때 재평가): SSE job_progress가 DB 상태보다 선발행(wired-pipeline.ts) / manual 스테이징 파일 잔존(manual.ts) / 서버 재시작 시 MANUAL 대기 잡을 failed 처리(재개는 게이트 반려 경로).
