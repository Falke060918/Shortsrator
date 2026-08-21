/**
 * 테마 카메라 문법 7종 ↔ Higgsfield dop motion_id 매핑
 * (docs/03_테마명세_신비한건축사전.md §5, docs/03-architecture.md).
 *
 * 실값 출처: GET /v1/motions 카탈로그 실측 (2026-08-21 frames 스모크, 총 121종).
 * motion_id는 UUID이며, 아래 7종은 전부 start_end_frame=true (frames 경로 사용 가능).
 * 테마별 재정의는 theme-preset 단위(model_config) 소관.
 */

/** 카메라 무빙 7종 — 키는 샷리스트 camera_moves/motion_prompt에 쓰는 영문 표기 */
export const CAMERA_MOTION_IDS: ReadonlyArray<{
  /** motion_prompt 안에서 이 무빙을 식별할 키워드 (소문자 매칭) */
  keywords: string[];
  motionId: string;
}> = [
  // ① Slow push-in → "Dolly In"
  {
    keywords: ["push-in", "push in"],
    motionId: "81ca2cd2-05db-4222-9ba0-a32e5185adfb",
  },
  // ② Dolly + tilt (스케일 강조) → "Tilt up"
  { keywords: ["dolly"], motionId: "2c9af101-fe7a-4299-91f3-e44431a0576f" },
  // ③ Orbit → "360 Orbit"
  { keywords: ["orbit"], motionId: "ea035f68-b350-40f1-b7f4-7dff999fdd67" },
  // ④ Fly-through (내부 진입) → "FPV Drone"
  {
    keywords: ["fly-through", "fly through"],
    motionId: "7673d9e0-208c-4cf8-8b72-fce5b0e92ecb",
  },
  // ⑤ Descending drone → "Crane Down"
  {
    keywords: ["descending", "drone down"],
    motionId: "b26dcbe5-e784-4893-b8a3-2bd4f848e90a",
  },
  // ⑥ Macro → pull back → "Super Dolly Out"
  {
    keywords: ["macro", "pull back", "pull-back"],
    motionId: "679c128d-a109-4267-8007-12f653f6346d",
  },
  // ⑦ Follow path (흐름 추적) → "Flying"
  {
    keywords: ["follow path", "follow the"],
    motionId: "1d5ee550-a8b2-4200-8909-4ca7795911dc",
  },
];

/**
 * motion_prompt에서 첫 번째로 매칭되는 카메라 무빙의 motion_id를 찾는다.
 * (한 클립 카메라 동작 1~2개 규칙 — 첫 매칭이 주 동작)
 * 매칭 없으면 undefined — 페이로드에서 motion_id를 생략한다.
 */
export function resolveMotionId(motionPrompt: string): string | undefined {
  const lowered = motionPrompt.toLowerCase();
  for (const entry of CAMERA_MOTION_IDS) {
    if (entry.keywords.some((keyword) => lowered.includes(keyword))) {
      return entry.motionId;
    }
  }
  return undefined;
}
