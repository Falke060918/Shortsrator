/**
 * ffmpeg 실행 통합테스트 (이슈 #6 완료 조건: 샘플 입력 → 9:16 mp4,
 * 총길이 = 오디오 실측 합 ±0.1s). 샘플은 ffmpeg lavfi로 생성하고
 * 산출물은 OS 임시 디렉터리에만 둔다 — 커밋 금지.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFfmpeg } from "./ffmpeg.js";
import { probeDurationMs, probeVideoStream } from "./probe.js";
import {
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  assembleEpisode,
  assertTrimGrid,
} from "./assemble.js";

/** 오디오-영상 싱크 허용 오차(ms) — 이슈 #6: ±0.1s */
const TOLERANCE_MS = 100;
const FFMPEG_TIMEOUT = 120_000;

let dir: string;
let audio1: string;
let audio2: string;
let clip1: string;
let clip2: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "shortsrator-asm-test-"));
  audio1 = path.join(dir, "a1.wav");
  audio2 = path.join(dir, "a2.wav");
  clip1 = path.join(dir, "clip1.mp4");
  clip2 = path.join(dir, "clip2.mp4");

  // 무음 오디오 2개 (문장 TTS 대역) — 길이가 서로 다르게
  await runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1.3", audio1]);
  await runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.8", audio2]);
  // 컬러 클립 2개 — clip1은 16:9(패드 경로 검증), clip2는 이미 9:16
  await runFfmpeg([
    "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30", "-t", "3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", clip1,
  ]);
  await runFfmpeg([
    "-f", "lavfi", "-i", "color=c=blue:s=540x960:r=30", "-t", "2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", clip2,
  ]);
}, FFMPEG_TIMEOUT);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("probeDurationMs", () => {
  it("무음 오디오의 길이를 ms 실측한다", async () => {
    const ms = await probeDurationMs(audio1);
    expect(Math.abs(ms - 1300)).toBeLessThanOrEqual(50);
  });

  it("없는 파일이면 던진다", async () => {
    await expect(probeDurationMs(path.join(dir, "없는파일.wav"))).rejects.toThrow();
  });
});

describe("assertTrimGrid", () => {
  it("0.1초 그리드는 통과한다", () => {
    expect(() => assertTrimGrid(0, "in_ms")).not.toThrow();
    expect(() => assertTrimGrid(500, "in_ms")).not.toThrow();
  });

  it("그리드 밖 값은 던진다", () => {
    expect(() => assertTrimGrid(250, "in_ms")).toThrow(/0\.1초/);
    expect(() => assertTrimGrid(-100, "in_ms")).toThrow();
    expect(() => assertTrimGrid(100.5, "in_ms")).toThrow();
  });
});

describe("assembleEpisode (ffmpeg 통합)", () => {
  it(
    "trim+mux+concat으로 9:16 mp4를 산출하고 총길이가 오디오 실측 합과 일치한다(±0.1s)",
    async () => {
      const outPath = path.join(dir, "final.mp4");
      const result = await assembleEpisode(
        [
          { clipPath: clip1, audioPath: audio1, in_ms: 500 },
          { clipPath: clip2, audioPath: audio2 },
        ],
        outPath,
      );

      // 산출 파일이 실제로 존재한다
      const st = await stat(outPath);
      expect(st.size).toBeGreaterThan(0);

      // 컷 길이 = 각 오디오 실측
      const expected =
        (await probeDurationMs(audio1)) + (await probeDurationMs(audio2));
      expect(result.cutDurationsMs.reduce((a, b) => a + b, 0)).toBe(expected);

      // 총길이(실측)가 오디오 실측 합과 ±0.1s 이내
      const total = await probeDurationMs(outPath);
      expect(Math.abs(total - expected)).toBeLessThanOrEqual(TOLERANCE_MS);
      expect(result.duration_ms).toBe(total);

      // 9:16(1080x1920) 산출
      const { width, height } = await probeVideoStream(outPath);
      expect(width).toBe(OUTPUT_WIDTH);
      expect(height).toBe(OUTPUT_HEIGHT);
    },
    FFMPEG_TIMEOUT,
  );

  it(
    "오디오보다 짧은 클립도 마지막 프레임 클론으로 오디오 길이를 채운다",
    async () => {
      const outPath = path.join(dir, "short-clip.mp4");
      // clip2는 2.0s, in_ms=1500이면 남은 영상 0.5s < 오디오 0.8s
      const result = await assembleEpisode(
        [{ clipPath: clip2, audioPath: audio2, in_ms: 1500 }],
        outPath,
      );
      const expected = await probeDurationMs(audio2);
      expect(Math.abs(result.duration_ms - expected)).toBeLessThanOrEqual(
        TOLERANCE_MS,
      );
    },
    FFMPEG_TIMEOUT,
  );

  it("빈 컷 배열이면 던진다", async () => {
    await expect(assembleEpisode([], path.join(dir, "x.mp4"))).rejects.toThrow();
  });
});
