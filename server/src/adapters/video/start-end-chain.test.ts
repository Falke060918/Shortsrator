import { describe, expect, it, vi } from "vitest";
import type {
  JobHandle,
  StartEndInput,
  VideoAdapter,
} from "@shortsrator/shared";
import { HiggsfieldApiError } from "../higgsfield/client.js";
import { ManualVideoAdapter } from "../manual/manual-adapters.js";
import {
  DEFAULT_FLASH_DURATION_MS,
  StartEndChain,
  StartEndChainExhaustedError,
} from "./start-end-chain.js";

const input: StartEndInput = {
  startFramePath: "frames/exterior.png",
  endFramePath: "frames/interior.png",
  motionPrompt: "fly-through the entrance",
  duration_ms: 3000,
};

function makeApiStub(overrides: Partial<VideoAdapter> = {}): VideoAdapter {
  let seq = 0;
  const handle = (): Promise<JobHandle> =>
    Promise.resolve({ jobId: `api-${++seq}`, requestId: `req-${seq}` });
  return {
    mode: "api",
    poll: vi.fn(),
    i2v: vi.fn(handle),
    startEnd: vi.fn(handle),
    t2v: vi.fn(handle),
    ...overrides,
  } as VideoAdapter;
}

describe("StartEndChain", () => {
  it("frames 성공 시 그대로 채택한다", async () => {
    const api = makeApiStub();
    const chain = new StartEndChain(api, new ManualVideoAdapter());
    const plan = await chain.run(input);
    expect(plan.transition).toBe("frames");
    expect(api.startEnd).toHaveBeenCalledWith(input);
  });

  it("frames 미지원(4xx) 거부 시 edit_splice로 강등 — I2V 2건 + 플래시 접합 스펙", async () => {
    const api = makeApiStub({
      startEnd: vi.fn(() =>
        Promise.reject(
          new HiggsfieldApiError("end_image not supported", 422),
        ),
      ),
    });
    const chain = new StartEndChain(api, new ManualVideoAdapter());
    const plan = await chain.run(input);

    expect(plan.transition).toBe("edit_splice");
    if (plan.transition !== "edit_splice") throw new Error("unreachable");
    expect(plan.startClip.jobId).toBeTruthy();
    expect(plan.endClip.jobId).toBeTruthy();
    // 스펙 분해만 — 실제 클립 생성 호출은 I2V 2건으로 표현
    expect(api.i2v).toHaveBeenCalledTimes(2);
    const i2vMock = vi.mocked(api.i2v);
    expect(i2vMock.mock.calls[0][0]).toMatchObject({
      imagePath: "frames/exterior.png",
      duration_ms: 1500,
    });
    expect(i2vMock.mock.calls[1][0]).toMatchObject({
      imagePath: "frames/interior.png",
      duration_ms: 1500,
    });
    // 접합은 플래시/가림 — 단순 dissolve 금지
    expect(plan.splice).toEqual({
      kind: "flash",
      atMs: 1500,
      flashDurationMs: DEFAULT_FLASH_DURATION_MS,
    });
  });

  it("홀수 ms는 전/후반으로 정수 분할된다", async () => {
    const api = makeApiStub({
      startEnd: vi.fn(() => Promise.reject(new Error("down"))),
    });
    const chain = new StartEndChain(api, new ManualVideoAdapter());
    const plan = await chain.run({ ...input, duration_ms: 3001 });
    if (plan.transition !== "edit_splice") throw new Error("unreachable");
    const i2vMock = vi.mocked(api.i2v);
    expect(i2vMock.mock.calls[0][0].duration_ms).toBe(1500);
    expect(i2vMock.mock.calls[1][0].duration_ms).toBe(1501);
  });

  it("frames·I2V 모두 실패하면 manual로 강등 — manual_pending 지시서", async () => {
    const api = makeApiStub({
      startEnd: vi.fn(() => Promise.reject(new Error("api down"))),
      i2v: vi.fn(() => Promise.reject(new Error("api down"))),
    });
    const manual = new ManualVideoAdapter();
    const chain = new StartEndChain(api, manual);
    const plan = await chain.run(input);

    expect(plan.transition).toBe("manual");
    if (plan.transition !== "manual") throw new Error("unreachable");
    const snap = await manual.poll(plan.handle);
    expect(snap.status).toBe("manual_pending");
    expect(snap.instructions?.referenceFilePaths).toEqual([
      "frames/exterior.png",
      "frames/interior.png",
    ]);
  });

  it("샷 스펙의 chain 순서를 따른다 (manual 단독도 가능)", async () => {
    const api = makeApiStub();
    const chain = new StartEndChain(api, new ManualVideoAdapter());
    const plan = await chain.run(input, ["manual"]);
    expect(plan.transition).toBe("manual");
    expect(api.startEnd).not.toHaveBeenCalled();
  });

  it("manual 없는 체인이 모두 실패하면 소진 에러", async () => {
    const api = makeApiStub({
      startEnd: vi.fn(() => Promise.reject(new Error("down"))),
      i2v: vi.fn(() => Promise.reject(new Error("down"))),
    });
    const chain = new StartEndChain(api, new ManualVideoAdapter());
    await expect(
      chain.run(input, ["frames", "edit_splice"]),
    ).rejects.toThrow(StartEndChainExhaustedError);
  });
});
