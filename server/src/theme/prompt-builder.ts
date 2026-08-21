/**
 * 프롬프트 빌더 — 파이프라인 단계별 생성 프롬프트에 테마 규칙을 주입한다 (REQ-THEME-01).
 *
 *   MASTER_ASSET → buildMasterAssetPrompts  (기준 이미지 4장, §4)
 *   FRAME_GEN    → buildImagePrompt         (style_string 고정 부착, §3)
 *   VIDEO_GEN    → buildMotionPrompt / buildStartEndMotionPrompt / buildBrollPrompt (§5)
 *
 * 생성 프롬프트는 전부 영문이다 — 한국어는 프리셋의 메모 필드에만 존재한다.
 * 카메라 무빙 선택 보조: suggestCameraMoves (내레이션-카메라 동기화, §5).
 */

import { ThemePresetError } from "./loader.js";
import type { CameraMove, MasterAssetRole, ThemePreset } from "./types.js";

/** 모든 모션 프롬프트의 고정 마무리 문장 (테마 대표 프롬프트 예시의 공통 꼬리) */
const MOTION_CLOSING = "Continuous seamless documentary shot.";

/** Start+End 전환의 고정 마무리 문장 */
const START_END_CLOSING = "Continuous forward camera movement.";

function resolveCameraMoves(preset: ThemePreset, moveIds: string[]): CameraMove[] {
  return moveIds.map((id) => {
    const move = preset.camera_grammar.find((m) => m.id === id);
    if (!move) {
      throw new ThemePresetError(preset.id, [`카메라 문법에 없는 id "${id}"`]);
    }
    return move;
  });
}

function assertMoveCount(preset: ThemePreset, count: number, reveal: boolean): void {
  const cap = reveal
    ? preset.camera_rules.max_moves_reveal_clip
    : preset.camera_rules.max_moves_per_clip;
  if (count === 0) {
    throw new ThemePresetError(preset.id, ["카메라 동작이 최소 1개 필요하다"]);
  }
  if (count > cap) {
    throw new ThemePresetError(preset.id, [
      `카메라 동작 ${count}개 — ${reveal ? "리빌 컷" : "일반 컷"} 상한 ${cap}개 초과`,
    ]);
  }
}

/**
 * FRAME_GEN: 이미지 프롬프트 — 피사체·구도 기술 뒤에 style_string을 고정 부착한다 (§3).
 * ShotSpec.image_prompt 의 원천.
 */
export function buildImagePrompt(preset: ThemePreset, subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.length === 0) {
    throw new ThemePresetError(preset.id, ["이미지 프롬프트의 피사체 기술이 비어 있다"]);
  }
  return `${trimmed}, ${preset.style_string}`;
}

/**
 * MASTER_ASSET: 주제 하나당 기준 이미지 4장(EXTERIOR/INTERIOR/CROSS_SECTION/CUTAWAY)의
 * 생성 프롬프트 — 이후 모든 첫 프레임의 레퍼런스로 재사용된다 (§4).
 */
export function buildMasterAssetPrompts(
  preset: ThemePreset,
  subject: string,
): Array<{ role: MasterAssetRole; prompt: string }> {
  return preset.master_asset_schema.map((slot) => ({
    role: slot.role,
    prompt: buildImagePrompt(
      preset,
      slot.prompt_template.replaceAll("{subject}", subject.trim()),
    ),
  }));
}

/**
 * VIDEO_GEN(I2V): 모션 프롬프트 — 카메라 문법의 영문 모션 문장을 순서대로 이어 붙인다.
 * 동작 개수 상한(일반 2, 리빌 3)을 강제한다 (§5). ShotSpec.motion_prompt 의 원천.
 */
export function buildMotionPrompt(
  preset: ThemePreset,
  moveIds: string[],
  options: { reveal?: boolean } = {},
): string {
  assertMoveCount(preset, moveIds.length, options.reveal === true);
  const moves = resolveCameraMoves(preset, moveIds);
  return [...moves.map((m) => m.motion.prompt), MOTION_CLOSING].join("\n\n");
}

/**
 * VIDEO_GEN(START_END): 시작·끝 프레임 전환 모션 프롬프트 (§5 Start+End 예시 형식).
 * 프레임 기술은 호출자가 영문으로 넘긴다.
 */
export function buildStartEndMotionPrompt(
  preset: ThemePreset,
  input: { startFrame: string; endFrame: string; moveIds: string[] },
): string {
  assertMoveCount(preset, input.moveIds.length, false);
  const moves = resolveCameraMoves(preset, input.moveIds);
  return [
    `START FRAME: ${input.startFrame.trim()} / END FRAME: ${input.endFrame.trim()}`,
    ...moves.map((m) => m.motion.prompt),
    START_END_CLOSING,
  ].join("\n\n");
}

/** VIDEO_GEN(T2V): B-roll 프롬프트 — 장면 기술에 style_string을 부착한다 */
export function buildBrollPrompt(preset: ThemePreset, scene: string): string {
  return buildImagePrompt(preset, scene);
}

/** I2V 어댑터(Higgsfield dop)로 넘길 motion_id — 카메라 문법 id ↔ motion 매핑 */
export function motionIdFor(preset: ThemePreset, moveId: string): string {
  const [move] = resolveCameraMoves(preset, [moveId]);
  return move.motion.motion_id;
}

/**
 * 내레이션-카메라 동기화 (§5): 내레이션 문장에서 키워드를 찾아 권장 카메라 무빙을
 * 제안한다. 매칭이 없으면 빈 배열 — 선택은 샷리스트 단계의 몫이다.
 */
export function suggestCameraMoves(preset: ThemePreset, narration: string): string[] {
  const suggested: string[] = [];
  for (const rule of preset.narration_sync) {
    if (rule.keywords.some((keyword) => narration.includes(keyword))) {
      for (const id of rule.camera_move_ids) {
        if (!suggested.includes(id)) suggested.push(id);
      }
    }
  }
  return suggested;
}
