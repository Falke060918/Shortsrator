/**
 * 1일차 frames 지원 판정 스모크 (docs/03-architecture.md 수용 리스크:
 * "Higgsfield frames·9:16·레퍼런스 입력 API 노출 미확인 — 1일차 스모크로 판정").
 *
 * 실행 (API 키가 .env에 있을 때만 동작):
 *   npx tsx server/scripts/higgsfield-frames-smoke.ts \
 *     --start <시작프레임 URL> --end <끝프레임 URL> \
 *     [--motion "fly-through the entrance"] [--duration-ms 3000] [--timeout-ms 180000]
 *
 * 종료 코드:
 *   0 = frames 지원 확정 (클립 생성 완료)
 *   2 = frames 미지원 판정 (4xx 거부) → edit_splice 강등 확정
 *   1 = 키 없음 / 사용법 오류 / 기타 오류 (판정 불가)
 */

import path from "node:path";
import { tmpdir } from "node:os";
import {
  HiggsfieldApiError,
  HiggsfieldClient,
} from "../src/adapters/higgsfield/client.js";
import { HiggsfieldVideoAdapter } from "../src/adapters/video/higgsfield-video-adapter.js";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  // .env 로드 (Node 21.7+ 내장 — 없으면 조용히 건너뛰고 process.env만 쓴다)
  try {
    process.loadEnvFile();
  } catch {
    /* .env 없음 — 무시 */
  }

  let client: HiggsfieldClient;
  try {
    client = HiggsfieldClient.fromEnv();
  } catch (err) {
    console.error(
      `[스모크] ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  const start = readArg("start");
  const end = readArg("end");
  if (!start || !end) {
    console.error(
      "[스모크] 사용법: npx tsx server/scripts/higgsfield-frames-smoke.ts --start <URL> --end <URL> [--motion ...] [--duration-ms 3000]",
    );
    return 1;
  }
  const motion = readArg("motion") ?? "fly-through the entrance";
  const durationMs = Number.parseInt(readArg("duration-ms") ?? "3000", 10);
  const timeoutMs = Number.parseInt(readArg("timeout-ms") ?? "180000", 10);

  const outputDir = path.join(tmpdir(), "shortsrator-frames-smoke");
  const adapter = new HiggsfieldVideoAdapter({ client, outputDir });

  console.log("[스모크] frames(start_image/end_image) 제출 시도…");
  let handle;
  try {
    handle = await adapter.startEnd({
      startFramePath: start,
      endFramePath: end,
      motionPrompt: motion,
      duration_ms: durationMs,
    });
  } catch (err) {
    if (err instanceof HiggsfieldApiError && err.isCapabilityRejection) {
      console.error(`[스모크] 제출 거부(HTTP ${err.statusCode}): ${err.message}`);
      console.error(
        "[판정] frames 미지원 → start_end 강등 체인은 edit_splice(I2V 2건 + 플래시 스플라이스)로 간다.",
      );
      return 2;
    }
    throw err;
  }

  console.log(
    `[스모크] request_id=${handle.requestId} — 2초 간격 폴링 (최대 ${timeoutMs}ms)…`,
  );
  if (!handle.requestId) throw new Error("request_id 없음");
  const snapshot = await client.waitForCompletion(handle.requestId, {
    timeoutMs,
  });

  if (snapshot.status !== "completed") {
    console.error(
      `[스모크] 생성 실패: status=${snapshot.status} error=${snapshot.error ?? "-"}`,
    );
    console.error("[판정] 불확정 — 파라미터/모델을 바꿔 재시도하거나 강등 체인에 맡겨라.");
    return 1;
  }

  const done = await adapter.poll(handle);
  console.log(`[스모크] 완료 — 클립: ${done.output?.clipFilePaths.join(", ")}`);
  if (done.cost) {
    console.log(
      `[스모크] 비용: credits=${done.cost.credits ?? "-"} krw=${done.cost.krw ?? "-"}`,
    );
  }
  console.log("[판정] frames 지원 확정 — transition_type=frames 사용 가능.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(
      `[스모크] 오류: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
