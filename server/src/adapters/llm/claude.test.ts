import type { JobHandle, JobSnapshot } from "@shortsrator/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeLLMAdapter } from "./claude.js";

/** submit 즉시 반환된 핸들을 완료(succeeded/failed)까지 폴링한다 */
async function pollUntilSettled<T>(
  adapter: { poll(h: JobHandle): Promise<JobSnapshot<T>> },
  handle: JobHandle,
): Promise<JobSnapshot<T>> {
  for (let i = 0; i < 200; i++) {
    const snap = await adapter.poll(handle);
    if (snap.status === "succeeded" || snap.status === "failed") return snap;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("잡이 제한 시간 안에 끝나지 않았다");
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function makeFakeFetch(
  respond: () => Response,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  };
  return { fetchImpl, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ClaudeLLMAdapter", () => {
  it("schema 가 있으면 강제 tool_choice 로 JSON 스키마 출력을 받는다 (REQ-SCRIPT-01)", async () => {
    const structured = {
      title: "판테온",
      shots: [{ idx: 0, narration: "로마의 심장에는 구멍 뚫린 돔이 있다." }],
    };
    const { fetchImpl, calls } = makeFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "emit_structured_output",
                input: structured,
              },
            ],
            usage: { input_tokens: 1000, output_tokens: 500 },
          }),
          { status: 200 },
        ),
    );

    const adapter = new ClaudeLLMAdapter({ apiKey: "test-key", fetchImpl });
    const handle = await adapter.generate({
      prompt: "15초 5컷 대본을 만들어라",
      schema: { type: "object", properties: { title: { type: "string" } } },
    });
    const snap = await pollUntilSettled(adapter, handle);

    expect(snap.status).toBe("succeeded");
    expect(JSON.parse(snap.output!.text)).toEqual(structured);
    // 완료 스냅샷에 비용 메타가 실린다
    expect(snap.cost?.krw).toBeGreaterThan(0);

    // 요청 검증: 키 헤더 + 강제 tool_choice
    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.tool_choice).toEqual({
      type: "tool",
      name: "emit_structured_output",
    });
    expect(body.tools[0].input_schema).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  it("schema 없이 호출하면 텍스트 블록을 그대로 돌려준다", async () => {
    const { fetchImpl } = makeFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "자유 형식 응답" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200 },
        ),
    );

    const adapter = new ClaudeLLMAdapter({ apiKey: "test-key", fetchImpl });
    const handle = await adapter.generate({ prompt: "안녕" });
    const snap = await pollUntilSettled(adapter, handle);

    expect(snap.status).toBe("succeeded");
    expect(snap.output?.text).toBe("자유 형식 응답");
  });

  it("HTTP 오류면 잡이 failed 로 전이하고 상태 코드가 담긴다", async () => {
    const { fetchImpl } = makeFakeFetch(
      () => new Response("overloaded", { status: 529 }),
    );

    const adapter = new ClaudeLLMAdapter({ apiKey: "test-key", fetchImpl });
    const handle = await adapter.generate({ prompt: "안녕" });
    const snap = await pollUntilSettled(adapter, handle);

    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("529");
  });

  it("API 키가 없으면 fetch 없이 즉시 failed 잡을 만든다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { fetchImpl, calls } = makeFakeFetch(
      () => new Response("unreachable", { status: 200 }),
    );

    const adapter = new ClaudeLLMAdapter({ fetchImpl });
    const handle = await adapter.generate({ prompt: "안녕" });
    const snap = await adapter.poll(handle);

    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("ANTHROPIC_API_KEY");
    expect(calls).toHaveLength(0);
  });

  it("모르는 핸들을 폴링하면 failed 스냅샷을 돌려준다", async () => {
    const adapter = new ClaudeLLMAdapter({ apiKey: "test-key" });
    const snap = await adapter.poll({ jobId: "no-such-job" });
    expect(snap.status).toBe("failed");
  });
});
