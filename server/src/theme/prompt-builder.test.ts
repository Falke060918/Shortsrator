import { describe, expect, it } from "vitest";
import { loadThemePreset, ThemePresetError } from "./loader.js";
import {
  buildBrollPrompt,
  buildImagePrompt,
  buildMasterAssetPrompts,
  buildMotionPrompt,
  buildStartEndMotionPrompt,
  motionIdFor,
  suggestCameraMoves,
} from "./prompt-builder.js";

const preset = loadThemePreset("mysterious-architecture");

describe("이미지 프롬프트 (FRAME_GEN)", () => {
  it("피사체 기술 끝에 style_string을 고정 부착한다 (§3)", () => {
    const prompt = buildImagePrompt(preset, "Pantheon dome seen from below");
    expect(prompt.startsWith("Pantheon dome seen from below, ")).toBe(true);
    expect(prompt.endsWith(preset.style_string)).toBe(true);
  });

  it("피사체 기술이 비어 있으면 던진다", () => {
    expect(() => buildImagePrompt(preset, "  ")).toThrow(ThemePresetError);
  });
});

describe("마스터 애셋 프롬프트 (MASTER_ASSET)", () => {
  it("4역할 각각 subject 치환 + style_string 부착으로 만든다 (§4)", () => {
    const prompts = buildMasterAssetPrompts(preset, "the Pantheon in Rome");
    expect(prompts.map((p) => p.role)).toEqual([
      "EXTERIOR",
      "INTERIOR",
      "CROSS_SECTION",
      "CUTAWAY",
    ]);
    for (const { prompt } of prompts) {
      expect(prompt).toContain("the Pantheon in Rome");
      expect(prompt).not.toContain("{subject}");
      expect(prompt.endsWith(preset.style_string)).toBe(true);
    }
  });
});

describe("모션 프롬프트 (VIDEO_GEN)", () => {
  it("카메라 문법의 영문 모션 문장을 주입하고 다큐 샷 문장으로 닫는다 (§5)", () => {
    const prompt = buildMotionPrompt(preset, ["slow_push_in"]);
    expect(prompt).toContain("The camera slowly pushes in");
    expect(prompt.endsWith("Continuous seamless documentary shot.")).toBe(true);
  });

  it("일반 컷은 동작 2개까지, 3개는 거부한다", () => {
    expect(() =>
      buildMotionPrompt(preset, ["slow_push_in", "orbit"]),
    ).not.toThrow();
    expect(() =>
      buildMotionPrompt(preset, ["slow_push_in", "orbit", "fly_through"]),
    ).toThrow(ThemePresetError);
  });

  it("리빌 컷은 동작 3개(A→B→C)까지 허용한다", () => {
    const prompt = buildMotionPrompt(
      preset,
      ["slow_push_in", "orbit", "fly_through"],
      { reveal: true },
    );
    expect(prompt).toContain("arcs slowly around");
  });

  it("카메라 문법에 없는 id는 거부한다", () => {
    expect(() => buildMotionPrompt(preset, ["zoom_crash"])).toThrow(
      ThemePresetError,
    );
  });

  it("START_END는 시작/끝 프레임 기술과 전진 이동 문장을 포함한다", () => {
    const prompt = buildStartEndMotionPrompt(preset, {
      startFrame: "stadium exterior",
      endFrame: "interior roof cable system",
      moveIds: ["fly_through"],
    });
    expect(prompt).toContain(
      "START FRAME: stadium exterior / END FRAME: interior roof cable system",
    );
    expect(prompt.endsWith("Continuous forward camera movement.")).toBe(true);
  });

  it("B-roll(T2V)에도 style_string이 부착된다", () => {
    expect(
      buildBrollPrompt(preset, "deep sea ruins shrouded in darkness").endsWith(
        preset.style_string,
      ),
    ).toBe(true);
  });
});

describe("motion_id 매핑", () => {
  it("카메라 문법 id를 I2V 어댑터 motion_id로 변환한다", () => {
    // 실값 UUID — GET /v1/motions 실측 "360 Orbit" (2026-08-21 frames 스모크)
    expect(motionIdFor(preset, "orbit")).toBe(
      "ea035f68-b350-40f1-b7f4-7dff999fdd67",
    );
    expect(() => motionIdFor(preset, "nope")).toThrow(ThemePresetError);
  });
});

describe("내레이션-카메라 동기화 (§5)", () => {
  it('"지하" 내레이션에는 하강 계열을 제안한다', () => {
    expect(
      suggestCameraMoves(preset, "비밀은 지하 20미터에 있었습니다."),
    ).toContain("descending_drone");
  });

  it('"분산" 내레이션에는 follow path를 제안한다', () => {
    expect(
      suggestCameraMoves(preset, "하중은 여덟 개의 기둥으로 분산됩니다."),
    ).toContain("follow_path");
  });

  it("매칭이 없으면 빈 배열이다", () => {
    expect(suggestCameraMoves(preset, "이 돔은 아름답습니다.")).toEqual([]);
  });
});
