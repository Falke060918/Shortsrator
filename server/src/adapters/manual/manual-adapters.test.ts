import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ManualImageAdapter,
  ManualLLMAdapter,
  ManualTTSAdapter,
  ManualVideoAdapter,
} from "./manual-adapters.js";
import { ManualFileValidationError } from "./manual-base.js";

describe("ManualLLMAdapter", () => {
  it("submit 즉시 manual_pending + 복붙 프롬프트 지시서를 노출한다", async () => {
    const adapter = new ManualLLMAdapter();
    const handle = await adapter.generate({
      prompt: "판테온 대본을 써라",
      schema: { type: "object" },
    });
    const snap = await adapter.poll(handle);
    expect(snap.status).toBe("manual_pending");
    expect(snap.instructions?.prompts).toEqual(["판테온 대본을 써라"]);
    expect(snap.instructions?.body).toContain("JSON 스키마");
    expect(snap.instructions?.expectedFileExtensions).toEqual([
      "txt",
      "md",
      "json",
    ]);
  });

  it("텍스트 파일 드롭 시 succeeded로 전이하고 내용을 읽는다", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "manual-llm-"));
    const filePath = path.join(dir, "script.txt");
    await writeFile(filePath, "판테온의 비밀", "utf-8");

    const adapter = new ManualLLMAdapter();
    const handle = await adapter.generate({ prompt: "p" });
    const snap = await adapter.attachFiles(handle, [filePath]);
    expect(snap.status).toBe("succeeded");
    expect(snap.output?.text).toBe("판테온의 비밀");
    // 수동 제작은 API 과금 0을 명시
    expect(snap.cost).toEqual({ credits: 0, krw: 0 });
  });
});

describe("ManualTTSAdapter", () => {
  it("오디오 드롭 시 주입된 프로브로 duration_ms를 실측한다", async () => {
    const adapter = new ManualTTSAdapter({
      probeDurationMs: async () => 2340,
    });
    const handle = await adapter.synthesize({
      text: "돌인데 1900년을 버텼다",
      voice: "voice-1",
    });
    const pending = await adapter.poll(handle);
    expect(pending.status).toBe("manual_pending");
    expect(pending.instructions?.prompts).toEqual(["돌인데 1900년을 버텼다"]);
    expect(pending.instructions?.body).toContain("voice-1");

    const snap = await adapter.attachFiles(handle, ["out/sentence1.mp3"]);
    expect(snap.status).toBe("succeeded");
    expect(snap.output).toEqual({
      audioFilePath: "out/sentence1.mp3",
      duration_ms: 2340,
    });
  });
});

describe("ManualImageAdapter", () => {
  it("레퍼런스·비율·장수를 지시서에 싣고, 이미지 드롭으로 완료된다", async () => {
    const adapter = new ManualImageAdapter();
    const handle = await adapter.generate({
      prompt: "Pantheon interior",
      referenceImagePaths: ["master/pantheon.png"],
      aspect: "9:16",
      count: 3,
    });
    const pending = await adapter.poll(handle);
    expect(pending.instructions?.referenceFilePaths).toEqual([
      "master/pantheon.png",
    ]);
    expect(pending.instructions?.body).toContain("9:16");
    expect(pending.instructions?.body).toContain("3장");

    const snap = await adapter.attachFiles(handle, ["a.png", "b.webp"]);
    expect(snap.status).toBe("succeeded");
    expect(snap.output?.imageFilePaths).toEqual(["a.png", "b.webp"]);
  });

  it("허용 외 확장자는 거부하고 manual_pending을 유지한다", async () => {
    const adapter = new ManualImageAdapter();
    const handle = await adapter.generate({
      prompt: "p",
      referenceImagePaths: [],
      aspect: "9:16",
    });
    await expect(adapter.attachFiles(handle, ["clip.mp4"])).rejects.toThrow(
      ManualFileValidationError,
    );
    const snap = await adapter.poll(handle);
    expect(snap.status).toBe("manual_pending");
  });

  it("빈 드롭은 거부한다", async () => {
    const adapter = new ManualImageAdapter();
    const handle = await adapter.generate({
      prompt: "p",
      referenceImagePaths: [],
      aspect: "9:16",
    });
    await expect(adapter.attachFiles(handle, [])).rejects.toThrow(
      ManualFileValidationError,
    );
  });
});

describe("ManualVideoAdapter", () => {
  it("i2v/startEnd/t2v 각각 지시서를 만들고 mp4/mov만 받는다", async () => {
    const adapter = new ManualVideoAdapter();

    const i2v = await adapter.i2v({
      imagePath: "frames/shot1.png",
      motionPrompt: "orbit",
      duration_ms: 3200,
    });
    const i2vSnap = await adapter.poll(i2v);
    expect(i2vSnap.instructions?.referenceFilePaths).toEqual([
      "frames/shot1.png",
    ]);
    expect(i2vSnap.instructions?.body).toContain("3.2초");
    expect(i2vSnap.instructions?.expectedFileExtensions).toEqual([
      "mp4",
      "mov",
    ]);

    const startEnd = await adapter.startEnd({
      startFramePath: "a.png",
      endFramePath: "b.png",
      motionPrompt: "fly-through",
      duration_ms: 3000,
    });
    const seSnap = await adapter.poll(startEnd);
    expect(seSnap.instructions?.referenceFilePaths).toEqual(["a.png", "b.png"]);

    const t2v = await adapter.t2v({ prompt: "b-roll", duration_ms: 2000 });
    const done = await adapter.attachFiles(t2v, ["clip.mov"]);
    expect(done.status).toBe("succeeded");
    expect(done.output?.clipFilePaths).toEqual(["clip.mov"]);
  });

  it("완료된 잡에 재드롭하면 거부한다", async () => {
    const adapter = new ManualVideoAdapter();
    const handle = await adapter.t2v({ prompt: "p", duration_ms: 1000 });
    await adapter.attachFiles(handle, ["clip.mp4"]);
    await expect(adapter.attachFiles(handle, ["clip2.mp4"])).rejects.toThrow(
      ManualFileValidationError,
    );
  });

  it("미지의 잡 poll은 throw한다", async () => {
    const adapter = new ManualVideoAdapter();
    await expect(adapter.poll({ jobId: "ghost" })).rejects.toThrow(
      /알 수 없는 MANUAL 잡/,
    );
  });
});
