import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadThemePreset } from "../../theme/index.js";
import { HiggsfieldClient, type HiggsfieldDopTier } from "../higgsfield/client.js";
import {
  HiggsfieldVideoAdapter,
  msToDurationSec,
} from "./higgsfield-video-adapter.js";
import { resolveMotionId } from "./motion-map.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeAdapter(options: { tier?: HiggsfieldDopTier } = {}) {
  const submissions: Array<{ url: string; payload: Record<string, unknown> }> =
    [];
  const uploads: Array<{ url: string; headers: Record<string, string> }> = [];
  let uploadCount = 0;
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url);
    if (init?.method === "PUT") {
      uploads.push({
        url: urlStr,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return new Response(null, { status: 200 });
    }
    if (init?.method === "POST") {
      if (urlStr.includes("/files/generate-upload-url")) {
        uploadCount += 1;
        // 실측 형상 (2026-08-21): public_url/upload_url/upload_headers
        return jsonResponse({
          public_url: `https://cdn/inputs/upload-${uploadCount}.png`,
          upload_url: `https://s3/presigned-${uploadCount}`,
          content_type: "image/png",
          upload_headers: {
            "Content-Type": "image/png",
            "x-amz-tagging": "retention=temporary",
          },
        });
      }
      submissions.push({
        url: urlStr,
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
    tier: options.tier,
  });
  return { adapter, submissions, uploads };
}

/** 업로드 테스트용 실존 로컬 파일 2개 (readFile 이 실제로 읽는다) */
async function makeLocalFrames(): Promise<{ start: string; end: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "hf-video-test-"));
  const start = path.join(dir, "exterior.png");
  const end = path.join(dir, "interior.png");
  await writeFile(start, "png-start");
  await writeFile(end, "png-end");
  return { start, end };
}

describe("resolveMotionId", () => {
  it("카메라 문법 7종 키워드를 motion_id로 매핑한다", () => {
    // 실값 UUID — GET /v1/motions 실측 (2026-08-21 스모크), 주석은 벤더 모션 이름
    expect(resolveMotionId("Slow push-in toward the oculus")).toBe(
      "81ca2cd2-05db-4222-9ba0-a32e5185adfb", // Dolly In
    );
    expect(resolveMotionId("dolly forward with tilt up")).toBe(
      "2c9af101-fe7a-4299-91f3-e44431a0576f", // Tilt up
    );
    expect(resolveMotionId("orbit around the dome")).toBe(
      "ea035f68-b350-40f1-b7f4-7dff999fdd67", // 360 Orbit
    );
    expect(resolveMotionId("fly-through the entrance")).toBe(
      "7673d9e0-208c-4cf8-8b72-fce5b0e92ecb", // FPV Drone
    );
    expect(resolveMotionId("descending drone shot")).toBe(
      "b26dcbe5-e784-4893-b8a3-2bd4f848e90a", // Crane Down
    );
    expect(resolveMotionId("macro detail then pull back")).toBe(
      "679c128d-a109-4267-8007-12f653f6346d", // Super Dolly Out
    );
    expect(resolveMotionId("follow path of the water channel")).toBe(
      "1d5ee550-a8b2-4200-8909-4ca7795911dc", // Flying
    );
  });

  it("매칭 없으면 undefined", () => {
    expect(resolveMotionId("static shot")).toBeUndefined();
  });

  it("프리셋 camera_grammar 7종의 실제 영문 구문이 전부 매핑에 도달한다", () => {
    // wired 경로의 motion_prompt 는 buildMotionPrompt 가 이 구문들을 이어 붙인다
    const preset = loadThemePreset("mysterious-architecture");
    for (const move of preset.camera_grammar) {
      expect(resolveMotionId(move.motion.prompt), move.id).toBe(
        move.motion.motion_id,
      );
    }
  });

  it("여러 구문 연결 시 프롬프트에서 먼저 등장한 동작이 주 동작이다", () => {
    const preset = loadThemePreset("mysterious-architecture");
    const macro = preset.camera_grammar.find((m) => m.id === "macro_pull_back")!;
    const orbit = preset.camera_grammar.find((m) => m.id === "orbit")!;
    const combined = [
      macro.motion.prompt,
      orbit.motion.prompt,
      "Continuous seamless documentary shot.",
    ].join("\n\n");
    // 배열 순서(orbit ③ < macro ⑥)가 아니라 등장 위치가 기준이다
    expect(resolveMotionId(combined)).toBe(macro.motion.motion_id);
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
      motion_id: "ea035f68-b350-40f1-b7f4-7dff999fdd67", // 360 Orbit
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
  it("신 표면 first-last-frame 에 prompt/image_url/end_image_url/motions 를 제출한다", async () => {
    const { adapter, submissions } = makeAdapter();
    await adapter.startEnd({
      startFramePath: "https://cdn/frames/exterior.png",
      endFramePath: "https://cdn/frames/interior.png",
      motionPrompt: "fly-through the entrance",
      duration_ms: 3000,
    });
    expect(submissions[0].url).toContain(
      "/higgsfield-ai/dop/lite/first-last-frame", // 기본 티어 lite
    );
    expect(submissions[0].payload).toEqual({
      prompt: "fly-through the entrance",
      image_url: "https://cdn/frames/exterior.png",
      end_image_url: "https://cdn/frames/interior.png",
      motions: [
        { id: "7673d9e0-208c-4cf8-8b72-fce5b0e92ecb", strength: 0.5 }, // FPV Drone
      ],
    });
  });

  it("로컬 프레임 경로는 프리사인 업로드를 거쳐 public_url 로 제출된다", async () => {
    const { adapter, submissions, uploads } = makeAdapter();
    const { start, end } = await makeLocalFrames();
    await adapter.startEnd({
      startFramePath: start,
      endFramePath: end,
      motionPrompt: "orbit around the dome",
      duration_ms: 3000,
    });
    // 업로드 PUT 은 발급받은 upload_headers 를 그대로 쓴다 (x-amz-tagging 서명 포함)
    expect(uploads).toHaveLength(2);
    expect(uploads[0].headers["x-amz-tagging"]).toBe("retention=temporary");
    const payload = submissions[0].payload;
    expect(String(payload.image_url)).toMatch(/^https:\/\/cdn\/inputs\//);
    expect(String(payload.end_image_url)).toMatch(/^https:\/\/cdn\/inputs\//);
    expect(payload.image_url).not.toBe(payload.end_image_url);
  });

  it("매핑 안 되는 motion 프롬프트면 motions 를 생략한다", async () => {
    const { adapter, submissions } = makeAdapter();
    await adapter.startEnd({
      startFramePath: "https://cdn/a.png",
      endFramePath: "https://cdn/b.png",
      motionPrompt: "gentle ambient movement",
      duration_ms: 3000,
    });
    expect(submissions[0].payload).not.toHaveProperty("motions");
  });

  it("tier 옵션이 엔드포인트 티어를 바꾼다", async () => {
    const { adapter, submissions } = makeAdapter({ tier: "turbo" });
    await adapter.startEnd({
      startFramePath: "https://cdn/a.png",
      endFramePath: "https://cdn/b.png",
      motionPrompt: "fly-through the entrance",
      duration_ms: 3000,
    });
    expect(submissions[0].url).toContain(
      "/higgsfield-ai/dop/turbo/first-last-frame",
    );
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
