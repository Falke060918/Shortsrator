/**
 * 테마 프리셋 스키마 검증 — 외부 스키마 라이브러리 없이 손수 검증한다.
 * 반환값은 오류 메시지 배열이다 (빈 배열 = 유효). 로더가 이걸 모아 한 번에 던진다.
 */

import { GEN_METHODS, THEME_STATUSES } from "@shortsrator/shared";
import {
  CAMERA_FREQUENCIES,
  MASTER_ASSET_ROLES,
  type ThemePreset,
} from "./types.js";

/** 이 테마 프레임워크가 요구하는 카메라 문법 개수 (테마명세 §5 — 7종) */
export const CAMERA_GRAMMAR_SIZE = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * 프리셋 검증 — 구조·타입뿐 아니라 테마 규칙까지 본다:
 * 스타일 문자열의 9:16 명시, 마스터 애셋 4역할, 카메라 문법 7종,
 * 파일럿 샷 길이 합계, 카메라 동작 상한, 보이스 락.
 */
export function validateThemePreset(data: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(data)) {
    return ["프리셋 루트가 객체가 아니다"];
  }

  if (!isNonEmptyString(data.id)) errors.push("id: 비어 있지 않은 문자열이어야 한다");
  if (!isNonEmptyString(data.title)) errors.push("title: 비어 있지 않은 문자열이어야 한다");
  if (!THEME_STATUSES.includes(data.status as (typeof THEME_STATUSES)[number])) {
    errors.push(`status: ${THEME_STATUSES.join("|")} 중 하나여야 한다`);
  }
  if (!isPositiveInt(data.version)) errors.push("version: 양의 정수여야 한다");

  // format
  if (!isRecord(data.format)) {
    errors.push("format: 객체여야 한다");
  } else {
    if (data.format.aspect !== "9:16") {
      errors.push('format.aspect: 세로 숏츠 테마이므로 "9:16"이어야 한다');
    }
    if (!isPositiveInt(data.format.pilot_total_ms)) {
      errors.push("format.pilot_total_ms: 양의 정수(ms)여야 한다");
    }
    if (!isPositiveInt(data.format.pilot_shot_count)) {
      errors.push("format.pilot_shot_count: 양의 정수여야 한다");
    }
  }

  // style_string (§3) — 끝에 부착되는 고정 문자열, 9:16 명시 필수
  if (!isNonEmptyString(data.style_string)) {
    errors.push("style_string: 비어 있지 않은 문자열이어야 한다");
  } else if (!data.style_string.includes("9:16")) {
    errors.push("style_string: 9:16 세로 명시가 있어야 한다");
  }

  // master_asset_schema (§4) — 4역할 정확히 1개씩
  if (!Array.isArray(data.master_asset_schema)) {
    errors.push("master_asset_schema: 배열이어야 한다");
  } else {
    const roles = data.master_asset_schema
      .filter(isRecord)
      .map((slot) => slot.role);
    for (const role of MASTER_ASSET_ROLES) {
      if (roles.filter((r) => r === role).length !== 1) {
        errors.push(`master_asset_schema: ${role} 역할이 정확히 1개 있어야 한다`);
      }
    }
    for (const slot of data.master_asset_schema) {
      if (!isRecord(slot)) {
        errors.push("master_asset_schema: 각 항목은 객체여야 한다");
        continue;
      }
      if (!isNonEmptyString(slot.prompt_template)) {
        errors.push(`master_asset_schema[${String(slot.role)}].prompt_template: 비어 있지 않아야 한다`);
      } else if (!slot.prompt_template.includes("{subject}")) {
        errors.push(`master_asset_schema[${String(slot.role)}].prompt_template: {subject} 플레이스홀더가 있어야 한다`);
      }
    }
  }

  // camera_grammar (§5) — 7종, id 유일, motion 필수
  const grammarIds = new Set<string>();
  if (!Array.isArray(data.camera_grammar)) {
    errors.push("camera_grammar: 배열이어야 한다");
  } else {
    if (data.camera_grammar.length !== CAMERA_GRAMMAR_SIZE) {
      errors.push(`camera_grammar: 정확히 ${CAMERA_GRAMMAR_SIZE}종이어야 한다 (현재 ${data.camera_grammar.length})`);
    }
    for (const [i, move] of data.camera_grammar.entries()) {
      if (!isRecord(move) || !isNonEmptyString(move.id)) {
        errors.push(`camera_grammar[${i}]: id가 있는 객체여야 한다`);
        continue;
      }
      if (grammarIds.has(move.id)) {
        errors.push(`camera_grammar[${i}]: id "${move.id}" 중복`);
      }
      grammarIds.add(move.id);
      if (!isNonEmptyString(move.label)) errors.push(`camera_grammar[${move.id}].label: 비어 있지 않아야 한다`);
      if (!CAMERA_FREQUENCIES.includes(move.frequency as (typeof CAMERA_FREQUENCIES)[number])) {
        errors.push(`camera_grammar[${move.id}].frequency: ${CAMERA_FREQUENCIES.join("|")} 중 하나여야 한다`);
      }
      if (!isRecord(move.motion) || !isNonEmptyString(move.motion.motion_id) || !isNonEmptyString(move.motion.prompt)) {
        errors.push(`camera_grammar[${move.id}].motion: motion_id·prompt가 모두 있어야 한다`);
      }
    }
  }

  // camera_rules
  let maxMoves = 2;
  let maxMovesReveal = 3;
  if (!isRecord(data.camera_rules)) {
    errors.push("camera_rules: 객체여야 한다");
  } else {
    if (!isPositiveInt(data.camera_rules.max_moves_per_clip)) {
      errors.push("camera_rules.max_moves_per_clip: 양의 정수여야 한다");
    } else {
      maxMoves = data.camera_rules.max_moves_per_clip;
    }
    if (!isPositiveInt(data.camera_rules.max_moves_reveal_clip)) {
      errors.push("camera_rules.max_moves_reveal_clip: 양의 정수여야 한다");
    } else {
      maxMovesReveal = data.camera_rules.max_moves_reveal_clip;
    }
  }

  // narration_sync — 참조 무결성만
  if (!Array.isArray(data.narration_sync)) {
    errors.push("narration_sync: 배열이어야 한다");
  } else {
    for (const [i, rule] of data.narration_sync.entries()) {
      if (!isRecord(rule) || !isStringArray(rule.keywords) || !isStringArray(rule.camera_move_ids)) {
        errors.push(`narration_sync[${i}]: keywords·camera_move_ids 문자열 배열이 있어야 한다`);
        continue;
      }
      for (const id of rule.camera_move_ids) {
        if (!grammarIds.has(id)) {
          errors.push(`narration_sync[${i}]: 카메라 문법에 없는 id "${id}"`);
        }
      }
    }
  }

  // voice_config (§7) — 보이스 락은 이 테마 프레임워크의 불변 조건
  if (!isRecord(data.voice_config)) {
    errors.push("voice_config: 객체여야 한다");
  } else {
    if (data.voice_config.locked !== true) {
      errors.push("voice_config.locked: 보이스는 채널 고정이므로 true여야 한다");
    }
    if (!isNonEmptyString(data.voice_config.profile)) {
      errors.push("voice_config.profile: 비어 있지 않아야 한다");
    }
    const vendors = data.voice_config.vendor_priority;
    if (!isStringArray(vendors) || vendors.length === 0) {
      errors.push("voice_config.vendor_priority: 1개 이상의 벤더가 있어야 한다");
    }
  }

  // pilot_template (§6) — 순번·길이 합계·gen_method·카메라 참조/상한
  if (!Array.isArray(data.pilot_template)) {
    errors.push("pilot_template: 배열이어야 한다");
  } else {
    if (
      isRecord(data.format) &&
      isPositiveInt(data.format.pilot_shot_count) &&
      data.pilot_template.length !== data.format.pilot_shot_count
    ) {
      errors.push(`pilot_template: 샷 수가 format.pilot_shot_count(${data.format.pilot_shot_count})와 다르다`);
    }
    let totalMs = 0;
    for (const [i, shot] of data.pilot_template.entries()) {
      if (!isRecord(shot)) {
        errors.push(`pilot_template[${i}]: 객체여야 한다`);
        continue;
      }
      if (shot.idx !== i) errors.push(`pilot_template[${i}].idx: 0부터 순서대로여야 한다 (현재 ${String(shot.idx)})`);
      if (!isPositiveInt(shot.duration_ms)) {
        errors.push(`pilot_template[${i}].duration_ms: 양의 정수(ms)여야 한다`);
      } else {
        totalMs += shot.duration_ms;
      }
      if (!GEN_METHODS.includes(shot.gen_method as (typeof GEN_METHODS)[number])) {
        errors.push(`pilot_template[${i}].gen_method: ${GEN_METHODS.join("|")} 중 하나여야 한다`);
      }
      if (typeof shot.reveal !== "boolean") {
        errors.push(`pilot_template[${i}].reveal: boolean이어야 한다`);
      }
      if (!isStringArray(shot.camera_move_ids)) {
        errors.push(`pilot_template[${i}].camera_move_ids: 문자열 배열이어야 한다`);
      } else {
        for (const id of shot.camera_move_ids) {
          if (!grammarIds.has(id)) {
            errors.push(`pilot_template[${i}]: 카메라 문법에 없는 id "${id}"`);
          }
        }
        const cap = shot.reveal === true ? maxMovesReveal : maxMoves;
        if (shot.camera_move_ids.length > cap) {
          errors.push(`pilot_template[${i}]: 카메라 동작 ${shot.camera_move_ids.length}개 — 상한 ${cap}개 초과`);
        }
      }
    }
    if (
      isRecord(data.format) &&
      isPositiveInt(data.format.pilot_total_ms) &&
      totalMs !== data.format.pilot_total_ms
    ) {
      errors.push(`pilot_template: 길이 합계 ${totalMs}ms ≠ format.pilot_total_ms ${data.format.pilot_total_ms}ms`);
    }
  }

  return errors;
}

/** 검증을 통과하면 ThemePreset으로 좁혀 준다 */
export function isThemePreset(data: unknown): data is ThemePreset {
  return validateThemePreset(data).length === 0;
}
