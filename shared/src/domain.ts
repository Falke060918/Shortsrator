/**
 * 도메인 타입 — 기준 문서: docs/03-architecture.md ("되돌리기 어려운 결정" 2·3·4),
 * docs/01_솔루션_개발명세.md §2.
 *
 * 표기 규칙: DB 스키마(§8)를 그대로 비추는 필드는 snake_case(duration_ms 등),
 * API 요청/응답 전용 필드는 dto.ts에서 계약 표기(camelCase)를 따른다.
 */

/** 에피소드 상태머신 — 순서 고정, 되돌리기 어려운 결정 3 (01 문서 §2-3) */
export const EPISODE_STATES = [
  "TOPIC",
  "SCRIPT",
  "SCRIPT_GATE",
  "TTS",
  "SHOTLIST",
  "MASTER_ASSET",
  "FRAME_GEN",
  "FRAME_GATE",
  "VIDEO_GEN",
  "CLIP_GATE",
  "ASSEMBLY",
  "FINAL_GATE",
  "UPLOAD",
  "PUBLISHED",
] as const;
export type EpisodeState = (typeof EPISODE_STATES)[number];

/** 컨펌 게이트 4곳 (GATE1~4). GATE2(프레임)·GATE3(클립)은 어떤 설정으로도 스킵 불가. */
export const GATES = [
  "SCRIPT_GATE",
  "FRAME_GATE",
  "CLIP_GATE",
  "FINAL_GATE",
] as const;
export type Gate = (typeof GATES)[number];

export type GateDecisionValue = "approve" | "reject";

/** 테마 상태 (01 문서 §2-1) */
export const THEME_STATUSES = ["DRAFT", "TESTING", "FIXED", "ARCHIVED"] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];

/** 샷 생성 방식 (01 문서 §2-4) */
export const GEN_METHODS = ["I2V", "START_END", "T2V", "EDIT_ONLY"] as const;
export type GenMethod = (typeof GEN_METHODS)[number];

/**
 * START_END 샷의 전환 구현 방식 — 런타임 자동 강등 체인:
 * frames(Higgsfield) → edit_splice(I2V 2클립 + 플래시/가림 스플라이스, dissolve 금지) → manual.
 */
export const TRANSITION_TYPES = ["frames", "edit_splice", "manual"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/**
 * 샷 스펙 — 길이는 전부 ms 정수 (되돌리기 어려운 결정 4).
 * duration_ms 의 원천은 벤더 응답이 아니라 문장별 TTS 파일의 로컬 ffprobe 실측이다.
 */
export interface ShotSpec {
  id: string;
  episode_id: string;
  /** 샷 순번 (0-base) */
  idx: number;
  /** 내레이션 문장 1개 = 샷 1개 (1:1 매핑) */
  narration: string;
  /** TTS 실측 길이(ms 정수) — 이 값이 컷 길이를 결정한다 */
  duration_ms: number;
  gen_method: GenMethod;
  /** 테마 카메라 문법 7종 중 선택(+조합) */
  camera_moves: string[];
  /** 피사체·구도 기술 + 테마 style_string 고정 부착 */
  image_prompt: string;
  /** motion 전용 프롬프트 */
  motion_prompt: string;
  /** START_END 샷의 현재 전환 방식 */
  transition_type: TransitionType;
  /** transition_type 실패 시 순서대로 시도할 강등 체인 */
  fallback: TransitionType[];
  /** GATE3에서 채택된 클립/구간 (0.1초=100ms 단위 입력) */
  adopted_asset_id?: string;
  adopted_in_ms?: number;
  adopted_out_ms?: number;
}
