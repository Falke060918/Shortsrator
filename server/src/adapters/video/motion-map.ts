/**
 * 테마 카메라 문법 7종 ↔ Higgsfield dop motion_id 매핑
 * (docs/03_테마명세_신비한건축사전.md §5, docs/03-architecture.md).
 *
 * motion_id 실값은 1일차 스모크/모델 탐색으로 실측 후 교체한다 —
 * 여기 값은 자리표시 규약이며, 테마별 재정의는 theme-preset 단위(model_config) 소관.
 */

/** 카메라 무빙 7종 — 키는 샷리스트 camera_moves/motion_prompt에 쓰는 영문 표기 */
export const CAMERA_MOTION_IDS: ReadonlyArray<{
  /** motion_prompt 안에서 이 무빙을 식별할 키워드 (소문자 매칭) */
  keywords: string[];
  motionId: string;
}> = [
  { keywords: ["push-in", "push in"], motionId: "slow_push_in" },
  { keywords: ["dolly"], motionId: "dolly_tilt" },
  { keywords: ["orbit"], motionId: "orbit" },
  { keywords: ["fly-through", "fly through"], motionId: "fly_through" },
  { keywords: ["descending", "drone down"], motionId: "descending_drone" },
  { keywords: ["macro", "pull back", "pull-back"], motionId: "macro_pull_back" },
  { keywords: ["follow path", "follow the"], motionId: "follow_path" },
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
