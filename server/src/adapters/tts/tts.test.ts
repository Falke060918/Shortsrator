import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobHandle, JobSnapshot } from "@shortsrator/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsTTSAdapter } from "./elevenlabs.js";
import { createTTSAdapter } from "./index.js";
import { TypecastTTSAdapter } from "./typecast.js";

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

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);

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

const audioResponse = () =>
  new Response(AUDIO_BYTES.slice().buffer, { status: 200 });

/** ffprobe 실측 목 — 실제 ffprobe 없이 고정 ms 를 돌려준다 */
const fakeProbe = vi.fn(async () => 2873);

let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(path.join(os.tmpdir(), "shortsrator-tts-"));
  fakeProbe.mockClear();
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("ElevenLabsTTSAdapter", () => {
  it("문장을 합성해 파일로 쓰고 duration_ms 를 ffprobe 실측으로 얻는다 (REQ-TTS-01)", async () => {
    const { fetchImpl, calls } = makeFakeFetch(audioResponse);
    const adapter = new ElevenLabsTTSAdapter({
      apiKey: "el-key",
      outputDir,
      fetchImpl,
      probeDurationMs: fakeProbe,
    });

    const handle = await adapter.synthesize({
      text: "로마의 심장에는 구멍 뚫린 돔이 있다.",
      voice: "voice-123",
    });
    const snap = await pollUntilSettled(adapter, handle);

    expect(snap.status).toBe("succeeded");
    expect(snap.output?.duration_ms).toBe(2873);
    // 파일이 실제로 쓰였고, 실측은 그 파일을 대상으로 수행됐다
    expect(snap.output?.audioFilePath).toContain(outputDir);
    expect(snap.output?.audioFilePath.endsWith(".mp3")).toBe(true);
    expect(
      new Uint8Array(readFileSync(snap.output!.audioFilePath)),
    ).toEqual(AUDIO_BYTES);
    expect(fakeProbe).toHaveBeenCalledWith(snap.output!.audioFilePath);

    // 요청 검증: voice 가 URL 경로에, 키가 xi-api-key 헤더에 들어간다
    expect(calls[0].url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-123",
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("el-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.text).toBe("로마의 심장에는 구멍 뚫린 돔이 있다.");
  });

  it("HTTP 오류면 잡이 failed 로 전이한다", async () => {
    const { fetchImpl } = makeFakeFetch(
      () => new Response("quota exceeded", { status: 429 }),
    );
    const adapter = new ElevenLabsTTSAdapter({
      apiKey: "el-key",
      outputDir,
      fetchImpl,
      probeDurationMs: fakeProbe,
    });

    const snap = await pollUntilSettled(
      adapter,
      await adapter.synthesize({ text: "안녕", voice: "v" }),
    );

    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("429");
  });

  it("API 키가 없으면 fetch 없이 즉시 failed 잡을 만든다", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { fetchImpl, calls } = makeFakeFetch(audioResponse);
    const adapter = new ElevenLabsTTSAdapter({
      outputDir,
      fetchImpl,
      probeDurationMs: fakeProbe,
    });

    const snap = await adapter.poll(
      await adapter.synthesize({ text: "안녕", voice: "v" }),
    );

    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("ELEVENLABS_API_KEY");
    expect(calls).toHaveLength(0);
  });
});

describe("TypecastTTSAdapter", () => {
  it("문장을 합성해 wav 로 쓰고 duration_ms 를 ffprobe 실측으로 얻는다 (REQ-TTS-01)", async () => {
    const { fetchImpl, calls } = makeFakeFetch(audioResponse);
    const adapter = new TypecastTTSAdapter({
      apiKey: "tc-key",
      outputDir,
      fetchImpl,
      probeDurationMs: fakeProbe,
    });

    const handle = await adapter.synthesize({
      text: "돔의 눈으로 빛이 쏟아진다.",
      voice: "tc-voice-1",
    });
    const snap = await pollUntilSettled(adapter, handle);

    expect(snap.status).toBe("succeeded");
    expect(snap.output?.duration_ms).toBe(2873);
    expect(snap.output?.audioFilePath.endsWith(".wav")).toBe(true);

    // 요청 검증: X-API-KEY 헤더 + voice_id 본문
    expect(calls[0].url).toBe("https://api.typecast.ai/v1/text-to-speech");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("tc-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.voice_id).toBe("tc-voice-1");
    expect(body.text).toBe("돔의 눈으로 빛이 쏟아진다.");
  });

  it("API 키가 없으면 즉시 failed 잡을 만든다", async () => {
    vi.stubEnv("TYPECAST_API_KEY", "");
    const adapter = new TypecastTTSAdapter({
      outputDir,
      probeDurationMs: fakeProbe,
    });

    const snap = await adapter.poll(
      await adapter.synthesize({ text: "안녕", voice: "v" }),
    );

    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("TYPECAST_API_KEY");
  });
});

describe("createTTSAdapter (벤더 선택)", () => {
  it("설정값으로 벤더를 고른다", () => {
    expect(createTTSAdapter("elevenlabs")).toBeInstanceOf(
      ElevenLabsTTSAdapter,
    );
    expect(createTTSAdapter("typecast")).toBeInstanceOf(TypecastTTSAdapter);
  });
});
