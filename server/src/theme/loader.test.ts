import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESETS_DIR,
  listThemePresetIds,
  loadThemePreset,
  ThemePresetError,
} from "./loader.js";
import { CAMERA_GRAMMAR_SIZE, validateThemePreset } from "./schema.js";
import { MASTER_ASSET_ROLES } from "./types.js";

const PRESET_ID = "mysterious-architecture";

describe("프리셋 로더", () => {
  it("presets/에서 신비한건축 프리셋 id를 찾는다", () => {
    expect(listThemePresetIds(DEFAULT_PRESETS_DIR)).toContain(PRESET_ID);
  });

  it("신비한건축 프리셋이 로드·검증을 통과한다 (테마명세 §3~§7)", () => {
    const preset = loadThemePreset(PRESET_ID);
    expect(preset.id).toBe(PRESET_ID);
    expect(preset.status).toBe("DRAFT");
    expect(preset.format.aspect).toBe("9:16");

    // §3 스타일 문자열
    expect(preset.style_string).toContain("photorealistic architectural visualization");
    expect(preset.style_string).toContain("9:16 vertical");

    // §4 마스터 애셋 4역할
    expect(preset.master_asset_schema.map((s) => s.role).sort()).toEqual(
      [...MASTER_ASSET_ROLES].sort(),
    );

    // §5 카메라 문법 7종 + motion 매핑
    expect(preset.camera_grammar).toHaveLength(CAMERA_GRAMMAR_SIZE);
    for (const move of preset.camera_grammar) {
      expect(move.motion.motion_id.length).toBeGreaterThan(0);
      expect(move.motion.prompt.length).toBeGreaterThan(0);
    }

    // §6 표준 파일럿 15초 5컷
    expect(preset.pilot_template).toHaveLength(5);
    const total = preset.pilot_template.reduce((sum, s) => sum + s.duration_ms, 0);
    expect(total).toBe(15000);
    expect(preset.pilot_template[4].reveal).toBe(true);

    // §7 보이스 락
    expect(preset.voice_config.locked).toBe(true);
    expect(preset.voice_config.vendor_priority[0]).toBe("elevenlabs");
  });

  it("없는 프리셋 id는 ThemePresetError를 던진다", () => {
    expect(() => loadThemePreset("no-such-theme")).toThrow(ThemePresetError);
  });
});

describe("프리셋 스키마 검증", () => {
  const valid = () =>
    JSON.parse(
      JSON.stringify(loadThemePreset(PRESET_ID)),
    ) as Record<string, unknown> & {
      style_string: string;
      camera_grammar: Array<{ id: string }>;
      pilot_template: Array<{ duration_ms: number; camera_move_ids: string[] }>;
      voice_config: { locked: boolean };
    };

  it("유효한 프리셋은 오류가 없다", () => {
    expect(validateThemePreset(valid())).toEqual([]);
  });

  it("style_string에 9:16이 빠지면 거부한다", () => {
    const broken = valid();
    broken.style_string = "photorealistic";
    expect(validateThemePreset(broken).join("\n")).toContain("style_string");
  });

  it("카메라 문법이 7종이 아니면 거부한다", () => {
    const broken = valid();
    broken.camera_grammar = broken.camera_grammar.slice(0, 6);
    expect(validateThemePreset(broken).join("\n")).toContain("7종");
  });

  it("파일럿 길이 합계가 총 길이와 다르면 거부한다", () => {
    const broken = valid();
    broken.pilot_template[0].duration_ms = 9999;
    expect(validateThemePreset(broken).join("\n")).toContain("길이 합계");
  });

  it("파일럿 샷이 카메라 문법에 없는 id를 참조하면 거부한다", () => {
    const broken = valid();
    broken.pilot_template[0].camera_move_ids = ["nonexistent_move"];
    expect(validateThemePreset(broken).join("\n")).toContain("nonexistent_move");
  });

  it("보이스 락이 풀려 있으면 거부한다", () => {
    const broken = valid();
    broken.voice_config.locked = false;
    expect(validateThemePreset(broken).join("\n")).toContain("voice_config.locked");
  });
});
