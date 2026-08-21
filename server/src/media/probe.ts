/**
 * ffprobe 실측 래퍼 — duration_ms의 원천 (shared/src/domain.ts: "duration_ms 의 원천은
 * 벤더 응답이 아니라 문장별 TTS 파일의 로컬 ffprobe 실측이다").
 * 길이는 전부 ms 정수 (03-architecture 되돌리기 어려운 결정 4).
 */
import { runFfprobe } from "./ffmpeg.js";

/** 미디어 파일(오디오/비디오)의 컨테이너 길이를 ms 정수로 실측한다. */
export async function probeDurationMs(filePath: string): Promise<number> {
  const { stdout } = await runFfprobe([
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`ffprobe duration 파싱 실패: ${filePath} → "${stdout.trim()}"`);
  }
  return Math.round(seconds * 1000);
}

export interface VideoStreamInfo {
  width: number;
  height: number;
}

/** 첫 번째 비디오 스트림의 해상도를 읽는다 (9:16 산출 검증용). */
export async function probeVideoStream(filePath: string): Promise<VideoStreamInfo> {
  const { stdout } = await runFfprobe([
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    filePath,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`ffprobe 해상도 파싱 실패: ${filePath} → "${stdout.trim()}"`);
  }
  return { width, height };
}
