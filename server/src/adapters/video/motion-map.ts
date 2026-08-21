/**
 * 테마 카메라 문법 7종 ↔ Higgsfield dop motion_id 매핑
 * (docs/03_테마명세_신비한건축사전.md §5, docs/03-architecture.md).
 *
 * 실값 출처: GET /v1/motions 카탈로그 실측 (2026-08-21 frames 스모크, 총 121종).
 * motion_id는 UUID이며, 아래 7종은 전부 start_end_frame=true (frames 경로 사용 가능).
 * 테마별 재정의는 theme-preset 단위(model_config) 소관.
 */

/**
 * 카메라 무빙 7종 — 키는 샷리스트 camera_moves/motion_prompt에 쓰는 영문 표기.
 * 키워드는 프리셋 camera_grammar[].motion.prompt 의 실제 구문과 정합해야 한다
 * (wired 경로의 motion_prompt 는 buildMotionPrompt 가 프리셋 영문 구문을 이어
 * 붙인 것 — "pushes in"/"dollies"/"arcs" 같은 활용형까지 포함).
 */
export const CAMERA_MOTION_IDS: ReadonlyArray<{
  /** motion_prompt 안에서 이 무빙을 식별할 키워드 (소문자 매칭) */
  keywords: string[];
  motionId: string;
}> = [
  // ① Slow push-in → "Dolly In"
  {
    keywords: ["push-in", "push in", "pushes in"],
    motionId: "81ca2cd2-05db-4222-9ba0-a32e5185adfb",
  },
  // ② Dolly + tilt (스케일 강조) → "Tilt up"
  {
    keywords: ["dolly", "dollies"],
    motionId: "2c9af101-fe7a-4299-91f3-e44431a0576f",
  },
  // ③ Orbit → "360 Orbit"
  {
    keywords: ["orbit", "arcs around", "arcs"],
    motionId: "ea035f68-b350-40f1-b7f4-7dff999fdd67",
  },
  // ④ Fly-through (내부 진입) → "FPV Drone"
  {
    keywords: ["fly-through", "fly through", "flies forward", "flies through"],
    motionId: "7673d9e0-208c-4cf8-8b72-fce5b0e92ecb",
  },
  // ⑤ Descending drone → "Crane Down"
  {
    keywords: ["descending", "descends", "drone down"],
    motionId: "b26dcbe5-e784-4893-b8a3-2bd4f848e90a",
  },
  // ⑥ Macro → pull back → "Super Dolly Out"
  {
    keywords: ["macro", "pull back", "pull-back", "pulls back"],
    motionId: "679c128d-a109-4267-8007-12f653f6346d",
  },
  // ⑦ Follow path (흐름 추적) → "Flying"
  {
    keywords: ["follow path", "follows the path", "follow the"],
    motionId: "1d5ee550-a8b2-4200-8909-4ca7795911dc",
  },
];

/**
 * motion_prompt에서 가장 앞서 등장하는 카메라 무빙의 motion_id를 찾는다.
 * (한 클립 카메라 동작 1~2개 규칙 — 여러 구문 연결 시 첫 동작이 주 동작이므로
 * 배열 순서가 아니라 프롬프트 내 등장 위치로 판정한다)
 * 매칭 없으면 undefined — 페이로드에서 motions 를 생략한다.
 */
export function resolveMotionId(motionPrompt: string): string | undefined {
  const lowered = motionPrompt.toLowerCase();
  let best: { index: number; motionId: string } | undefined;
  for (const entry of CAMERA_MOTION_IDS) {
    for (const keyword of entry.keywords) {
      const index = lowered.indexOf(keyword);
      if (index >= 0 && (best === undefined || index < best.index)) {
        best = { index, motionId: entry.motionId };
      }
    }
  }
  return best?.motionId;
}
