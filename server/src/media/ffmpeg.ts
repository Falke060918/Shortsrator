/**
 * ffmpeg/ffprobe 실행 래퍼 — REQ-ASM-01 (docs/03-architecture.md ffmpeg-assembly 단위).
 * 두 바이너리는 PATH에 있다고 가정한다 (03-architecture "요구: ffmpeg PATH").
 * 실패 시 stderr 꼬리를 담은 에러를 던진다 — 조립 실패는 로그와 함께 중단(REQ-ASM-01 예외 조항).
 */
import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** 에러 메시지에 붙일 stderr 꼬리 줄 수 */
const STDERR_TAIL_LINES = 20;

function runBinary(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      reject(
        new Error(`${bin} 실행 실패 (PATH에 있는지 확인): ${err.message}`),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const tail = stderr.trim().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
      reject(
        new Error(`${bin} 종료 코드 ${code}\nargs: ${args.join(" ")}\n${tail}`),
      );
    });
  });
}

/** ffmpeg 실행 — 배너/진행바 억제, 덮어쓰기 허용, stdin 차단 */
export function runFfmpeg(args: string[]): Promise<RunResult> {
  return runBinary("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    ...args,
  ]);
}

/** ffprobe 실행 — 에러만 출력 */
export function runFfprobe(args: string[]): Promise<RunResult> {
  return runBinary("ffprobe", ["-v", "error", ...args]);
}
