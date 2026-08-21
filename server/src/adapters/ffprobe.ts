/**
 * ffprobe 실측 모듈 — 합성 오디오 파일의 길이를 로컬 ffprobe 로 ms 정수 실측한다.
 * 컷 길이의 원천은 벤더 API 응답이 아니라 이 실측값이다 (REQ-TTS-01, 벤더 중립 —
 * docs/03-architecture.md 채택안). ffmpeg(ffprobe 포함)가 PATH 에 있어야 한다.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 테스트 목 주입용 — ffprobe 를 인자 배열로 실행하고 stdout 을 돌려준다. */
export type FfprobeRunner = (args: string[]) => Promise<string>;

const defaultRunner: FfprobeRunner = async (args) => {
  try {
    // 셸 미경유(execFile) — Windows 경로/인용 문제와 무관하게 인자가 그대로 전달된다.
    const { stdout } = await execFileAsync("ffprobe", args);
    return stdout;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        "ffprobe 를 찾을 수 없다 — ffmpeg 이 PATH 에 있어야 한다 (docs/03-architecture.md 실행법)",
      );
    }
    throw err;
  }
};

/**
 * 파일 길이를 ms 정수로 실측한다.
 * `ffprobe -v error -show_entries format=duration -of json <file>` 의 초 단위
 * duration 을 반올림해 ms 로 바꾼다 (샷 길이 ms 정수 — 되돌리기 어려운 결정 4).
 */
export async function probeDurationMs(
  filePath: string,
  runner: FfprobeRunner = defaultRunner,
): Promise<number> {
  const stdout = await runner([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    filePath,
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe 출력이 JSON 이 아니다: ${stdout.slice(0, 200)}`);
  }

  const duration =
    typeof parsed === "object" &&
    parsed !== null &&
    "format" in parsed &&
    typeof parsed.format === "object" &&
    parsed.format !== null &&
    "duration" in parsed.format
      ? Number(parsed.format.duration)
      : NaN;

  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`ffprobe 가 duration 을 반환하지 않았다: ${filePath}`);
  }
  return Math.round(duration * 1000);
}
