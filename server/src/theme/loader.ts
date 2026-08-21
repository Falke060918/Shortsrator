/**
 * 프리셋 로더 — presets/{id}.json 을 읽어 검증하고 ThemePreset으로 반환한다.
 * 로컬 1인 앱의 부팅/요청 시 설정 로드이므로 동기 fs로 충분하다.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateThemePreset } from "./schema.js";
import type { ThemePreset } from "./types.js";

/** 저장소 루트의 presets/ — server/src/theme 기준 3단계 위 */
export const DEFAULT_PRESETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../presets",
);

export class ThemePresetError extends Error {
  readonly presetId: string;
  readonly errors: string[];

  constructor(presetId: string, errors: string[]) {
    super(`테마 프리셋 "${presetId}" 오류:\n- ${errors.join("\n- ")}`);
    this.name = "ThemePresetError";
    this.presetId = presetId;
    this.errors = errors;
  }
}

/** presets/ 안의 프리셋 id 목록 (*.json 파일명 기준) */
export function listThemePresetIds(presetsDir: string = DEFAULT_PRESETS_DIR): string[] {
  return readdirSync(presetsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

/** 프리셋 1개 로드 — 파싱·스키마 검증·id/파일명 일치까지 통과해야 반환한다 */
export function loadThemePreset(
  id: string,
  presetsDir: string = DEFAULT_PRESETS_DIR,
): ThemePreset {
  const filePath = path.join(presetsDir, `${id}.json`);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new ThemePresetError(id, [`프리셋 파일이 없다: ${filePath}`]);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ThemePresetError(id, [`JSON 파싱 실패: ${(err as Error).message}`]);
  }

  const errors = validateThemePreset(data);
  if (errors.length > 0) {
    throw new ThemePresetError(id, errors);
  }

  const preset = data as ThemePreset;
  if (preset.id !== id) {
    throw new ThemePresetError(id, [`프리셋 id "${preset.id}"가 파일명 "${id}"과 다르다`]);
  }
  return preset;
}
