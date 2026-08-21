import path from "node:path";
import { describe, expect, it } from "vitest";
import { HiggsfieldClient } from "../higgsfield/client.js";
import {
  HiggsfieldVideoAdapter,
  msToDurationSec,
} from "./higgsfield-video-adapter.js";
import { resolveMotionId } from "./motion-map.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeAdapter() {
  const submissions: Array<{ url: string; payload: Record<string, unknown> }> =
    [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      submissions.push({
        url: String(url),
        payload: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return jsonResponse({ id: `req-${submissions.length}` });
    }
    return jsonResponse({
      status: "completed",
      credits: 12,
      jobs: [{ results: { raw: { url: "https://cdn/clip.mp4" } } }],
    });
  }) as typeof fetch;
  const client = new HiggsfieldClient({ keyId: "k", secret: "s", fetchFn });
  const adapter = new HiggsfieldVideoAdapter({
    client,
    outputDir: path.join("workspace", "ep1", "clips"),
    downloadFn: async () => {},
  });
  return { adapter, submissions };
}

describe("resolveMotionId", () => {
  it("카메라 문법 7종 키워드를 motion_id로 매핑한다", () => {
    expect(resolveMotionId("Slow push-in toward the oculus")).toBe(
      "slow_push_in",
    );
    expect(resolveMotionId("dolly forward with tilt up")).toBe("dolly_tilt");
    expect(resolveMotionId("orbit around the dome")).toBe("orbit");
    expect(resolveMotionId("fly-through the entrance")).toBe("fly_through");
    expect(resolveMotionId("descending drone shot")).toBe("descending_drone");
    expect(resolveMotionId("macro detail then pull back")).toBe(
      "macro_pull_back",
    );
    expect(resolveMotionId("follow path of the water channel")).toBe(
      "follow_path",
    );
  });

  it("매칭 없으면 undefined", () => {
    expect(resolveMotionId("static shot")).toBeUndefined();
  });
});

describe("msToDurationSec", () => {
  it("ms 정수를 초로 반올림하고 최소 1초를 보장한다", () => {
    expect(msToDurationSec(3000)).toBe(3);
    expect(msToDurationSec(2600)).toBe(3);
    expect(msToDurationSec(300)).toBe(1);
  });
});

describe("HiggsfieldVideoAdapter.i2v", () => {
  it("dop 모델에 image role 미디어 + motion_id를 제출한다", async () => {
    const { adapter, submissions } = makeAdapter();
    await adapter.i2v({
      imagePath: "frames/shot1.png",
      motionPrompt: "orbit around the dome, dust motes drifting",
      duration_ms: 3200,
    });
    expect(submissions[0].url).toContain("/v1/image2video/dop");
    expect(submissions[0].payload).toEqual({
      medias: [{ role: "image", url: "frames/shot1.png" }],
      motion_prompt: "orbit around the dome, dust motes drifting",
      motion_id: "orbit",
      duration_sec: 3,
    });
  });

  it("매핑 안 되는 motion 프롬프트면 motion_id를 생략한다", async () => {
    const { adapter, submissions } = makeAdapter();
    await adapter.i2v({
      imagePath: "frames/shot1.png",
      motionPrompt: "gentle ambient movement",
      duration_ms: 2000,
    });
    expect(submissions[0].payload).not.toHaveProperty("motion_id");
  });
});

describe("HiggsfieldVideoAdapter.startEnd", () => {
  it("start_image/end_image role 2건을 제출한다 (frames 방식)", async () => {
    const { adapter, submissions } = makeAdapter();
    await adapter.startEnd({
      startFramePath: "frames/exterior.png",
      endFramePath: "frames/interior.png",
      motionPrompt: "fly-through the entrance",
      duration_ms: 3000,
    });
    expect(submissions[0].payload.medias).toEqual([
      { role: "start_image", url: "frames/exterior.png" },
      { role: "end_image", url: "frames/interior.png" },
    ]);
    expect(submissions[0].payload.motion_id).toBe("fly_through");
  });
});

describe("HiggsfieldVideoAdapter.t2v", () => {
  it("text2video 엔드포인트에 프롬프트만 제출한다 (B-roll)", async () => {
    const { adapter, submissions } = makeAdapter();
    await adapter.t2v({ prompt: "roman street b-roll", duration_ms: 2000 });
    expect(submissions[0].url).toContain("/v1/text2video/dop");
    expect(submissions[0].payload).toEqual({
      prompt: "roman street b-roll",
      duration_sec: 2,
    });
  });
});

describe("HiggsfieldVideoAdapter.poll", () => {
  it("완료 시 클립 파일 경로와 비용 메타를 반환한다", async () => {
    const { adapter } = makeAdapter();
    const snap = await adapter.poll({ jobId: "job-v", requestId: "req-1" });
    expect(snap.status).toBe("succeeded");
    expect(snap.output?.clipFilePaths[0]).toContain("job-v-0.mp4");
    expect(snap.cost).toEqual({ credits: 12 });
  });
});
