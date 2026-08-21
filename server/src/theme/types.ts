/**
 * 테마 프리셋 타입 — 기준 문서: docs/03_테마명세_신비한건축사전.md (REQ-THEME-01).
 * 문서 구조 자체가 "테마 하나를 정의할 때 채워야 하는 항목들"이므로,
 * 새 테마 프리셋(presets/*.json)도 이 타입 하나로 표현된다.
 *
 * 표기 규칙: 프리셋 JSON을 그대로 비추는 필드는 snake_case (shared/src/domain.ts와 동일).
 */

import type { AspectRatio, GenMethod, ThemeStatus, TTSVendor } from "@shortsrator/shared";

/** 마스터 애셋 4역할 (테마명세 §4) — 주제당 기준 이미지 4장, 모든 첫 프레임의 레퍼런스 */
export const MASTER_ASSET_ROLES = [
  "EXTERIOR",
  "INTERIOR",
  "CROSS_SECTION",
  "CUTAWAY",
] as const;
export type MasterAssetRole = (typeof MASTER_ASSET_ROLES)[number];

export const CAMERA_FREQUENCIES = ["high", "medium", "low"] as const;
export type CameraFrequency = (typeof CAMERA_FREQUENCIES)[number];

export interface MasterAssetSlot {
  role: MasterAssetRole;
  /** 역할 설명 (한국어 메모) */
  description: string;
  /** 생성 프롬프트 템플릿 — 영문, `{subject}` 플레이스홀더 필수 */
  prompt_template: string;
}

/** 카메라 문법 1종 (테마명세 §5) — motion.motion_id 는 I2V 어댑터(Higgsfield dop)의 motion 매핑 키 */
export interface CameraMove {
  id: string;
  label: string;
  /** 이 테마에서의 용도 (한국어 메모) */
  purpose: string;
  frequency: CameraFrequency;
  motion: {
    /** 어댑터 측 motion 식별자 (Higgsfield dop motion_id 매핑, 초기값) */
    motion_id: string;
    /** 영문 모션 프롬프트 문장 */
    prompt: string;
  };
}

/** 내레이션-카메라 동기화 규칙 (테마명세 §5) — 내레이션 키워드 → 권장 카메라 무빙 */
export interface NarrationSyncRule {
  keywords: string[];
  camera_move_ids: string[];
}

export interface CameraRules {
  /** 한 클립 카메라 동작 상한 (기본 2) */
  max_moves_per_clip: number;
  /** 리빌 컷만 허용되는 상한 (기본 3, A→B→C) */
  max_moves_reveal_clip: number;
}

/** 보이스 락 (테마명세 §7) — 채널 전체에서 고정 */
export interface VoiceConfig {
  locked: boolean;
  profile: string;
  vendor_priority: TTSVendor[];
  note?: string;
}

/** 표준 파일럿 샷 1개 (테마명세 §6) */
export interface PilotShotTemplate {
  /** 샷 순번 (0-base, ShotSpec.idx와 동일 규약) */
  idx: number;
  duration_ms: number;
  shot_type: string;
  gen_method: GenMethod;
  camera_move_ids: string[];
  /** 리빌 컷 여부 — true면 카메라 동작 상한이 max_moves_reveal_clip */
  reveal: boolean;
  /** 이 샷에 배정될 내레이션 역할 (한국어 메모) */
  narration_slot: string;
}

export interface ThemeFormat {
  aspect: AspectRatio;
  pilot_total_ms: number;
  pilot_shot_count: number;
}

export interface ThemePreset {
  /** presets/{id}.json 파일명과 일치 */
  id: string;
  title: string;
  status: ThemeStatus;
  version: number;
  format: ThemeFormat;
  /** 고정 스타일 문자열 (테마명세 §3) — 모든 이미지 프롬프트 끝에 동일 부착 */
  style_string: string;
  master_asset_schema: MasterAssetSlot[];
  /** 카메라 문법 7종 (테마명세 §5) */
  camera_grammar: CameraMove[];
  camera_rules: CameraRules;
  narration_sync: NarrationSyncRule[];
  voice_config: VoiceConfig;
  pilot_template: PilotShotTemplate[];
}
