import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POLL_INTERVAL_MS,
  HIGGSFIELD_ENDPOINTS,
  HiggsfieldApiError,
  HiggsfieldClient,
} from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchFn: typeof fetch, sleepFn?: (ms: number) => Promise<void>) {
  return new HiggsfieldClient({
    keyId: "KEY_ID",
    secret: "SECRET",
    fetchFn,
    sleepFn: sleepFn ?? (() => Promise.resolve()),
  });
}

describe("HiggsfieldClient.submit", () => {
  it("Key 인증 헤더로 POST하고 request_id를 반환한다", async () => {
    const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://platform.higgsfield.ai/v1/text2image/soul",
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Key KEY_ID:SECRET");
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: "p" });
      return jsonResponse({ id: "req-1" });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchFn);
    const requestId = await client.submit(
      HIGGSFIELD_ENDPOINTS.text2image("soul"),
      { prompt: "p" },
    );
    expect(requestId).toBe("req-1");
  });

  it("request_id 대체 필드명도 수용한다", async () => {
    const fetchFn = (async () =>
      jsonResponse({ request_id: "req-2" })) as typeof fetch;
    const client = makeClient(fetchFn);
    await expect(client.submit("/v1/x", {})).resolves.toBe("req-2");
  });

  it("4xx 거부는 isCapabilityRejection=true인 에러를 던진다", async () => {
    const fetchFn = (async () =>
      jsonResponse({ error: "end_image not supported" }, 422)) as typeof fetch;
    const client = makeClient(fetchFn);
    const error = await client.submit("/v1/x", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HiggsfieldApiError);
    expect((error as HiggsfieldApiError).isCapabilityRejection).toBe(true);
  });
});

describe("HiggsfieldClient.getRequest", () => {
  it("jobs[].results.raw.url 형상을 정규화한다", async () => {
    const fetchFn = (async () =>
      jsonResponse({
        status: "completed",
        credits: 7,
        jobs: [
          { results: { raw: { url: "https://cdn/a.png" } } },
          { results: { raw: { url: "https://cdn/b.png" } } },
        ],
      })) as typeof fetch;
    const client = makeClient(fetchFn);
    const snap = await client.getRequest("req-1");
    expect(snap.status).toBe("completed");
    expect(snap.resultUrls).toEqual(["https://cdn/a.png", "https://cdn/b.png"]);
    expect(snap.credits).toBe(7);
  });

  it("미지의 중간 상태는 in_progress로 취급한다", async () => {
    const fetchFn = (async () =>
      jsonResponse({ status: "processing" })) as typeof fetch;
    const client = makeClient(fetchFn);
    const snap = await client.getRequest("req-1");
    expect(snap.status).toBe("in_progress");
  });
});

describe("HiggsfieldClient.waitForCompletion", () => {
  it("완료까지 2초 간격으로 폴링한다", async () => {
    const statuses = ["queued", "in_progress", "completed"];
    let call = 0;
    const fetchFn = (async () =>
      jsonResponse({ status: statuses[call++], jobs: [] })) as typeof fetch;
    const sleeps: number[] = [];
    const client = makeClient(fetchFn, async (ms) => {
      sleeps.push(ms);
    });

    const snap = await client.waitForCompletion("req-1");
    expect(snap.status).toBe("completed");
    expect(sleeps).toEqual([
      DEFAULT_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ]);
  });

  it("failed로 끝나면 폴링을 멈추고 그 스냅샷을 반환한다", async () => {
    const fetchFn = (async () =>
      jsonResponse({ status: "failed", error: "boom" })) as typeof fetch;
    const client = makeClient(fetchFn);
    const snap = await client.waitForCompletion("req-1");
    expect(snap.status).toBe("failed");
    expect(snap.error).toBe("boom");
  });
});

describe("HiggsfieldClient.fromEnv", () => {
  it("키가 없으면 throw한다", () => {
    expect(() => HiggsfieldClient.fromEnv({})).toThrow(HiggsfieldApiError);
  });

  it("HF_API_KEY_ID/HF_API_SECRET로 생성된다", () => {
    const client = HiggsfieldClient.fromEnv({
      HF_API_KEY_ID: "k",
      HF_API_SECRET: "s",
    });
    expect(client).toBeInstanceOf(HiggsfieldClient);
  });
});
