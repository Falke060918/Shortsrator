/**
 * 9:16 숏츠 조립 모듈 — REQ-ASM-01 (자막·BGM/SFX 제외, 조립+싱크만).
 *
 * 규칙:
 * - 컷 길이 = 해당 내레이션 오디오의 로컬 ffprobe 실측(ms). 벤더 응답값을 쓰지 않는다.
 * - trim 시작점(in_ms)은 0.1초(100ms) 그리드 — GATE3 채택 구간 입력 단위(shared/src/domain.ts).
 * - 산출은 1080x1920(9:16), 비율이 다른 입력은 비율 유지 축소 후 검은 패드.
 * - 오디오보다 짧은 클립은 마지막 프레임 클론(tpad)으로 채워 싱크를 보장한다.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg.js";
import { probeDurationMs } from "./probe.js";

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const OUTPUT_FPS = 30;
/** 0.1초 = 100ms — trim 입력 정밀도 그리드 */
export const TRIM_GRID_MS = 100;

/** 컷 1개의 입력 — 채택 클립 + 문장 TTS 오디오 */
export interface CutInput {
  /** 채택된 클립 파일 경로 */
  clipPath: string;
  /** 문장 TTS 오디오 파일 경로 — 이 파일의 실측 길이가 곧 컷 길이 */
  audioPath: string;
  /** 클립 내 시작점(ms) — 0.1초 그리드, 생략 시 0 */
  in_ms?: number;
}

export interface CutResult {
  /** 컷 길이(ms) = 오디오 ffprobe 실측 */
  duration_ms: number;
}

export interface AssembleResult {
  /** 산출 mp4의 ffprobe 실측 총길이(ms) */
  duration_ms: number;
  /** 컷별 길이(ms) — 각 오디오 실측 */
  cutDurationsMs: number[];
}

/** ms 값이 0.1초 그리드에 있는지 검증한다. */
export function assertTrimGrid(ms: number, label: string): void {
  if (!Number.isInteger(ms) || ms < 0 || ms % TRIM_GRID_MS !== 0) {
    throw new Error(
      `${label}은(는) 0.1초(${TRIM_GRID_MS}ms) 단위의 0 이상 정수여야 한다: ${ms}`,
    );
  }
}

function msToSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** 1080x1920 정규화 필터: 비율 유지 축소 → 검은 패드 → 30fps → 부족분 마지막 프레임 클론 */
const CUT_VIDEO_FILTER = [
  `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease`,
  `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
  "setsar=1",
  `fps=${OUTPUT_FPS}`,
  "tpad=stop_mode=clone:stop=-1",
].join(",");

/**
 * 컷 1개를 렌더링한다: 0.1초 정밀 trim + 9:16 정규화 + 오디오 mux.
 * 출력 길이는 오디오 실측 길이로 고정된다(-t).
 */
export async function renderCut(cut: CutInput, outPath: string): Promise<CutResult> {
  const inMs = cut.in_ms ?? 0;
  assertTrimGrid(inMs, "in_ms");

  const audioMs = await probeDurationMs(cut.audioPath);
  if (audioMs <= 0) {
    throw new Error(`오디오 길이가 0 이하다: ${cut.audioPath}`);
  }

  await runFfmpeg([
    "-ss", msToSeconds(inMs),
    "-i", cut.clipPath,
    "-i", cut.audioPath,
    "-t", msToSeconds(audioMs),
    "-filter:v", CUT_VIDEO_FILTER,
    "-af", "apad",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    "-movflags", "+faststart",
    outPath,
  ]);

  return { duration_ms: audioMs };
}

/** concat 리스트 파일용 경로 이스케이프 — 슬래시 통일 + 단일따옴표 이스케이프 */
function toConcatEntry(filePath: string): string {
  const posix = path.resolve(filePath).replaceAll("\\", "/");
  return `file '${posix.replaceAll("'", "'\\''")}'`;
}

/** renderCut 산출물(동일 인코딩 파라미터)을 재인코딩 없이 이어붙인다. */
export async function concatCuts(cutPaths: string[], outPath: string): Promise<void> {
  if (cutPaths.length === 0) {
    throw new Error("concat할 컷이 없다");
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "shortsrator-concat-"));
  try {
    const listPath = path.join(workDir, "list.txt");
    const list = cutPaths.map(toConcatEntry).join("\n") + "\n";
    await writeFile(listPath, list, "utf-8");
    await runFfmpeg([
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      "-movflags", "+faststart",
      outPath,
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * 에피소드 조립: 컷별 렌더링(trim+9:16+mux) → concat → 총길이 실측 반환.
 * 총길이는 오디오 실측 합과 일치해야 한다 (REQ-ASM-01, 02-goals 지표 2).
 */
export async function assembleEpisode(
  cuts: CutInput[],
  outPath: string,
): Promise<AssembleResult> {
  if (cuts.length === 0) {
    throw new Error("조립할 컷이 없다");
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "shortsrator-assemble-"));
  try {
    const cutDurationsMs: number[] = [];
    const cutPaths: string[] = [];
    for (const [idx, cut] of cuts.entries()) {
      const cutPath = path.join(workDir, `cut-${String(idx).padStart(3, "0")}.mp4`);
      const { duration_ms } = await renderCut(cut, cutPath);
      cutDurationsMs.push(duration_ms);
      cutPaths.push(cutPath);
    }
    await concatCuts(cutPaths, outPath);
    const duration_ms = await probeDurationMs(outPath);
    return { duration_ms, cutDurationsMs };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
