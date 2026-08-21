import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HiggsfieldClient } from "../higgsfield/client.js";
import { HiggsfieldImageAdapter } from "./higgsfield-image-adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeAdapter(fetchFn: typeof fetch) {
  const client = new HiggsfieldClient({ keyId: "k", secret: "s", fetchFn });
  const downloads: Array<{ url: string; dest: string }> = [];
  const adapter = new HiggsfieldImageAdapter({
    client,
    outputDir: path.join("workspace", "ep1", "frames"),
    downloadFn: async (url, dest) => {
      downloads.push({ url, dest });
    },
    krwPerCredit: 20,
  });
  return { adapter, downloads };
}

describe("HiggsfieldImageAdapter.generate", () => {
  it("soul 모델 T2I 페이로드(프롬프트·비율·장수·레퍼런스)를 제출한다", async () => {
    let captured: { url: string; payload: Record<string, unknown> } | undefined;
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      captured = {
        url: String(url),
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return jsonResponse({ id: "req-img" });
    }) as typeof fetch;

    const { adapter } = makeAdapter(fetchFn);
    const handle = await adapter.generate({
      prompt: "Pantheon interior",
      referenceImagePaths: ["master/pantheon.png"],
      aspect: "9:16",
      count: 3,
    });

    expect(handle.requestId).toBe("req-img");
    expect(handle.jobId).toBeTruthy();
    expect(captured?.url).toContain("/v1/text2image/soul");
    expect(captured?.payload).toEqual({
      prompt: "Pantheon interior",
      aspect_ratio: "9:16",
      batch_size: 3,
      reference_images: ["master/pantheon.png"],
    });
  });

  it("count 생략 시 기본 2장, 레퍼런스 없으면 필드 생략", async () => {
    let payload: Record<string, unknown> = {};
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ id: "req-img" });
    }) as typeof fetch;

    const { adapter } = makeAdapter(fetchFn);
    await adapter.generate({
      prompt: "p",
      referenceImagePaths: [],
      aspect: "9:16",
    });
    expect(payload.batch_size).toBe(2);
    expect(payload).not.toHaveProperty("reference_images");
  });
});

describe("HiggsfieldImageAdapter.poll", () => {
  it("진행 중이면 running, 완료면 다운로드 후 succeeded + 비용 메타", async () => {
    const responses = [
      { status: "in_progress" },
      {
        status: "completed",
        credits: 5,
        jobs: [
          { results: { raw: { url: "https://cdn/a.png" } } },
          { results: { raw: { url: "https://cdn/b.png" } } },
        ],
      },
    ];
    let call = 0;
    const fetchFn = vi.fn(async () =>
      jsonResponse(responses[call++]),
    ) as unknown as typeof fetch;

    const { adapter, downloads } = makeAdapter(fetchFn);
    const handle = { jobId: "job-1", requestId: "req-img" };

    const running = await adapter.poll(handle);
    expect(running.status).toBe("running");

    const done = await adapter.poll(handle);
    expect(done.status).toBe("succeeded");
    expect(done.output?.imageFilePaths).toHaveLength(2);
    expect(done.output?.imageFilePaths[0]).toContain("job-1-0.png");
    expect(done.cost).toEqual({ credits: 5, krw: 100 });
    expect(downloads.map((d) => d.url)).toEqual([
      "https://cdn/a.png",
      "https://cdn/b.png",
    ]);
  });

  it("failed면 에러 메시지를 담는다", async () => {
    const fetchFn = (async () =>
      jsonResponse({ status: "failed", error: "moderation" })) as typeof fetch;
    const { adapter } = makeAdapter(fetchFn);
    const snap = await adapter.poll({ jobId: "j", requestId: "req-img" });
    expect(snap.status).toBe("failed");
    expect(snap.error).toBe("moderation");
  });

  it("requestId 없는 미지의 잡은 throw한다", async () => {
    const fetchFn = (async () => jsonResponse({})) as typeof fetch;
    const { adapter } = makeAdapter(fetchFn);
    await expect(adapter.poll({ jobId: "ghost" })).rejects.toThrow(
      /알 수 없는 잡/,
    );
  });
});
