/**
 * 부팅 시 테마 프리셋 로드 (issue #10 접합) — presets/*.json 을 읽어
 * themes/theme_versions 테이블에 반영한다. 프리셋 파일이 원천이며,
 * theme_versions.rules_json 에 프리셋 전문을 실어 에피소드가 참조한다.
 */

import type { Dao } from "../db/index.js";
import {
  DEFAULT_PRESETS_DIR,
  listThemePresetIds,
  loadThemePreset,
} from "../theme/index.js";

/** 프리셋 버전 행의 결정적 id — {presetId}-v{version} */
export function themeVersionIdOf(presetId: string, version: number): string {
  return `${presetId}-v${version}`;
}

/**
 * presets/ 의 모든 프리셋을 DB에 반영한다(멱등).
 * - 테마가 없으면 생성, 해당 version_no 의 버전 행이 없으면 추가.
 * - current_version_id 는 항상 프리셋 파일의 version 을 가리키게 한다(파일이 원천).
 */
export function ensureThemePresets(
  dao: Dao,
  presetsDir: string = DEFAULT_PRESETS_DIR,
): void {
  for (const id of listThemePresetIds(presetsDir)) {
    const preset = loadThemePreset(id, presetsDir);
    const versionId = themeVersionIdOf(preset.id, preset.version);

    if (!dao.themes.get(preset.id)) {
      dao.themes.insert({
        id: preset.id,
        name: preset.title,
        status: preset.status,
        channel_id: null,
        current_version_id: null,
      });
    }
    const versions = dao.themeVersions.listByTheme(preset.id);
    if (!versions.some((v) => v.version_no === preset.version)) {
      dao.themeVersions.insert({
        id: versionId,
        theme_id: preset.id,
        version_no: preset.version,
        rules_json: JSON.stringify(preset),
        changelog: `프리셋 파일 로드 v${preset.version}`,
      });
    }
    if (dao.themes.get(preset.id)?.current_version_id !== versionId) {
      dao.themes.setCurrentVersion(preset.id, versionId);
    }
  }
}
