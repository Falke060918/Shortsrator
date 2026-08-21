import { randomUUID } from "node:crypto";
import type {
  JobHandle,
  JobSnapshot,
  TTSAdapter,
  TTSOutput,
  TTSSynthesizeInput,
} from "@shortsrator/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobRunner } from "./job-runner.js";
import {
  DEFAULT_START_END_FALLBACK,
  DEFAULT_START_END_TRANSITION,
  buildShotlist,
  type SentencePlan,
} from "./shotlist.js";
import { openTestDb, seedEpisode, type TestDb } from "./test-fixtures.js";

/** 문장 → 실측 길이(ms) 표로 즉시 성공하는 가짜 TTS — ffprobe 실측을 흉내낸다 */
class FakeTTS implements TTSAdapter {
  readonly mode = "api" as const;
  synthesizedTexts: string[] = [];
  private readonly outputs = new Map<string, TTSOutput>();

  constructor(measurements: Record<string, number>) {
    for (const [text, ms] of Object.entries(measurements)) {
      this.outputs.set(text, {
        audioFilePath: `/tts/${ms}.mp3`,
        duration_ms: ms,
      });
    }
  }

  async synthesize(input: TTSSynthesizeInput): Promise<JobHandle> {
    this.synthesizedTexts.push(input.text);
    return { jobId: randomUUID(), requestId: input.text };
  }

  async poll(handle: JobHandle): Promise<JobSnapshot<TTSOutput>> {
    const output = this.outputs.get(handle.requestId ?? "");
    if (!output) return { status: "failed", error: "합성 실패" };
    return { status: "succeeded", output, cost: { krw: 100 } };
  }
}

const sentences: SentencePlan[] = [
  {
    narration: "판테온의 돔은 2천 년 동안 무너지지 않았다.",
    gen_method: "I2V",
    camera_moves: ["push_in"],
    image_prompt: "pantheon dome interior, cinematic",
    motion_prompt: "slow push in toward the oculus",
  },
  {
    narration: "비밀은 위로 갈수록 가벼워지는 콘크리트다.",
    gen_method: "START_END",
    camera_moves: ["ascend"],
    image_prompt: "cross section of the dome, cinematic",
    motion_prompt: "ascend along the coffers",
  },
  {
    narration: "그 중심에는 하늘로 뚫린 눈이 있다.",
    gen_method: "I2V",
    camera_moves: ["tilt_up"],
    image_prompt: "oculus beam of light, cinematic",
    motion_prompt: "tilt up into the light",
  },
];

let t: TestDb;
let episodeId: string;
let runner: JobRunner;

beforeEach(() => {
  t = openTestDb();
  episodeId = seedEpisode(t.dao).episodeId;
  runner = new JobRunner(t.dao, { sleep: () => Promise.resolve() });
});

afterEach(() => {
  t.close();
});

describe("buildShotlist — TTS 실측 → 문장1=샷1 → 컷 길이", () => {
  const measurements: Record<string, number> = {
    [sentences[0].narration]: 3200,
    [sentences[1].narration]: 2750,
    [sentences[2].narration]: 4100,
  };

  it("문장 1개 = 샷 1개, 컷 길이는 TTS 실측 ms 그대로", async () => {
    const tts = new FakeTTS(measurements);
    const { shots } = await buildShotlist(
      { dao: t.dao, runner, tts, ttsAdapterName: "elevenlabs" },
      { episodeId, voice: "voice-1", sentences },
    );

    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(shots.map((s) => s.duration_ms)).toEqual([3200, 2750, 4100]);
    expect(shots.map((s) => s.narration)).toEqual(
      sentences.map((s) => s.narration),
    );
    // 문장 순서대로 문장 단위 합성
    expect(tts.synthesizedTexts).toEqual(sentences.map((s) => s.narration));
  });

  it("START_END 샷에는 기본 강등 체인이, 나머지에는 빈 체인이 심긴다", async () => {
    const { shots } = await buildShotlist(
      { dao: t.dao, runner, tts: new FakeTTS(measurements), ttsAdapterName: "elevenlabs" },
      { episodeId, voice: "voice-1", sentences },
    );
    expect(shots[1].transition_type).toBe(DEFAULT_START_END_TRANSITION);
    expect(JSON.parse(shots[1].fallback_json)).toEqual([
      ...DEFAULT_START_END_FALLBACK,
    ]);
    expect(shots[0].transition_type).toBeNull();
    expect(JSON.parse(shots[0].fallback_json)).toEqual([]);
  });

  it("문장별 TTS 잡이 영속되고 비용이 집계 가능하다", async () => {
    await buildShotlist(
      { dao: t.dao, runner, tts: new FakeTTS(measurements), ttsAdapterName: "typecast" },
      { episodeId, voice: "voice-1", sentences },
    );
    const jobs = t.dao.jobs.listByEpisode(episodeId);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.kind === "tts" && j.adapter === "typecast")).toBe(true);
    expect(jobs.every((j) => j.status === "succeeded")).toBe(true);
    expect(jobs.reduce((sum, j) => sum + (j.cost_krw ?? 0), 0)).toBe(300);
  });

  it("TTS 실패 시 던지고 샷은 만들어지지 않는다", async () => {
    // 두 번째 문장 실측 누락 → poll failed
    const partial = { [sentences[0].narration]: 3200 };
    await expect(
      buildShotlist(
        { dao: t.dao, runner, tts: new FakeTTS(partial), ttsAdapterName: "elevenlabs" },
        { episodeId, voice: "voice-1", sentences },
      ),
    ).rejects.toThrow();
    expect(t.dao.shots.listByEpisode(episodeId)).toHaveLength(0);
  });

  it("빈 문장 목록은 거부", async () => {
    await expect(
      buildShotlist(
        { dao: t.dao, runner, tts: new FakeTTS({}), ttsAdapterName: "elevenlabs" },
        { episodeId, voice: "voice-1", sentences: [] },
      ),
    ).rejects.toThrow("문장이 없다");
  });
});
