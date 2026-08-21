import { randomUUID } from "node:crypto";
import type {
  I2VInput,
  JobHandle,
  JobSnapshot,
  StartEndInput,
  T2VInput,
  TransitionType,
  VideoAdapter,
  VideoOutput,
} from "@shortsrator/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManualVideoAdapter } from "../adapters/manual/manual-adapters.js";
import { StartEndChain } from "../adapters/video/start-end-chain.js";
import type { NewShot, ShotRow } from "../db/dao.js";
import { JobRunner } from "./job-runner.js";
import { chainOf, runStartEndShot } from "./start-end.js";
import { openTestDb, seedEpisode, type TestDb } from "./test-fixtures.js";

/** startEnd/i2v 를 켜고 끌 수 있는 가짜 API 비디오 어댑터 */
class FakeVideoAdapter implements VideoAdapter {
  readonly mode = "api" as const;
  startEndSupported = true;
  i2vSupported = true;
  startEndInputs: StartEndInput[] = [];
  i2vInputs: I2VInput[] = [];
  t2vInputs: T2VInput[] = [];

  async startEnd(input: StartEndInput): Promise<JobHandle> {
    this.startEndInputs.push(input);
    if (!this.startEndSupported) throw new Error("frames 미지원 (4xx)");
    return { jobId: randomUUID(), requestId: "se-req" };
  }

  async i2v(input: I2VInput): Promise<JobHandle> {
    this.i2vInputs.push(input);
    if (!this.i2vSupported) throw new Error("i2v 실패");
    return { jobId: randomUUID(), requestId: `i2v-${randomUUID().slice(0, 8)}` };
  }

  async t2v(input: T2VInput): Promise<JobHandle> {
    this.t2vInputs.push(input);
    return { jobId: randomUUID(), requestId: "t2v-req" };
  }

  async poll(handle: JobHandle): Promise<JobSnapshot<VideoOutput>> {
    return {
      status: "succeeded",
      output: { clipFilePaths: [`/clips/${handle.requestId}.mp4`] },
      cost: { credits: 5, krw: 700 },
    };
  }
}

const startEndInput: StartEndInput = {
  startFramePath: "/frames/start.png",
  endFramePath: "/frames/end.png",
  motionPrompt: "camera pushes through the doorway",
  duration_ms: 3000,
};

let t: TestDb;
let episodeId: string;
let runner: JobRunner;
let api: FakeVideoAdapter;
let manual: ManualVideoAdapter;
let chain: StartEndChain;

function insertStartEndShot(
  transition: TransitionType | null = "frames",
  fallbackJson = JSON.stringify(["edit_splice", "manual"]),
): ShotRow {
  const shot: NewShot = {
    id: randomUUID(),
    episode_id: episodeId,
    idx: 0,
    narration: "돔을 통과해 하늘이 드러난다.",
    duration_ms: 3000,
    gen_method: "START_END",
    camera_moves_json: JSON.stringify(["push_in"]),
    image_prompt: "dome doorway, cinematic",
    motion_prompt: "push through and reveal",
    transition_type: transition,
    fallback_json: fallbackJson,
    adopted_asset_id: null,
    adopted_in_ms: null,
    adopted_out_ms: null,
  };
  t.dao.shots.insert(shot);
  return t.dao.shots.get(shot.id)!;
}

beforeEach(() => {
  t = openTestDb();
  episodeId = seedEpisode(t.dao).episodeId;
  runner = new JobRunner(t.dao, {
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
  api = new FakeVideoAdapter();
  manual = new ManualVideoAdapter();
  chain = new StartEndChain(api, manual);
});

afterEach(() => {
  t.close();
});

describe("chainOf — 샷 스펙의 강등 체인 해석", () => {
  it("[transition_type, ...fallback] 순서", () => {
    const shot = insertStartEndShot("frames", JSON.stringify(["edit_splice", "manual"]));
    expect(chainOf(shot)).toEqual(["frames", "edit_splice", "manual"]);
  });

  it("손상된 fallback_json 은 기본 체인 전체로 폴백", () => {
    const shot = insertStartEndShot(null, "깨진 json");
    expect(chainOf(shot)).toEqual(["frames", "edit_splice", "manual"]);
  });
});

describe("runStartEndShot — 강등 체인 배선", () => {
  it("frames 성공: 잡 1건 영속·완주, transition_type 유지", async () => {
    const shot = insertStartEndShot();
    const result = await runStartEndShot(
      { dao: t.dao, runner, chain, api, manual },
      shot,
      startEndInput,
    );
    expect(result.transition).toBe("frames");
    expect(result.clipFilePaths).toEqual(["/clips/se-req.mp4"]);
    expect(t.dao.shots.get(shot.id)?.transition_type).toBe("frames");

    const jobs = t.dao.jobs.listByEpisode(episodeId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("video_start_end");
    expect(jobs[0].shot_id).toBe(shot.id);
    expect(jobs[0].status).toBe("succeeded");
    expect(jobs[0].cost_krw).toBe(700);
  });

  it("frames 실패 → edit_splice 강등: I2V 2클립 잡 + 접합 스펙, 샷에 강등 기록", async () => {
    api.startEndSupported = false;
    const shot = insertStartEndShot();
    const result = await runStartEndShot(
      { dao: t.dao, runner, chain, api, manual },
      shot,
      startEndInput,
    );

    expect(result.transition).toBe("edit_splice");
    expect(result.clipFilePaths).toHaveLength(2);
    expect(result.splice?.kind).toBe("flash"); // dissolve 금지
    // 강등 결과가 샷에 영속됐다
    expect(t.dao.shots.get(shot.id)?.transition_type).toBe("edit_splice");

    const jobs = t.dao.jobs.listByEpisode(episodeId);
    expect(jobs.map((j) => j.kind).sort()).toEqual([
      "video_splice_end",
      "video_splice_start",
    ]);
    expect(jobs.every((j) => j.status === "succeeded")).toBe(true);
    // 비용 집계 원천: 클립 2건 × 700원
    expect(jobs.reduce((sum, j) => sum + (j.cost_krw ?? 0), 0)).toBe(1400);
  });

  it("frames·edit_splice 모두 실패 → manual 종단: 드롭 후 완주", async () => {
    api.startEndSupported = false;
    api.i2vSupported = false;
    const shot = insertStartEndShot();

    const promise = runStartEndShot(
      { dao: t.dao, runner, chain, api, manual },
      shot,
      startEndInput,
    );

    // manual 잡 행이 영속될 때까지 대기 (manual_pending 폴링 중)
    let manualJob;
    for (let i = 0; i < 50 && !manualJob; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      manualJob = t.dao.jobs
        .listByEpisode(episodeId)
        .find((j) => j.adapter === "manual" && j.request_id !== null);
    }
    expect(manualJob).toBeDefined();
    expect(t.dao.shots.get(shot.id)?.transition_type).toBe("manual");

    // 크래시 재개와 같은 경로: request_id 로 핸들 복원 → 드롭 → succeeded
    await manual.attachFiles({ jobId: manualJob!.request_id! }, ["/drops/final.mp4"]);
    const result = await promise;
    expect(result.transition).toBe("manual");
    expect(result.clipFilePaths).toEqual(["/drops/final.mp4"]);
    expect(t.dao.jobs.get(manualJob!.id)?.status).toBe("succeeded");
  });

  it("START_END 가 아닌 샷은 거부", async () => {
    const shot = insertStartEndShot();
    const notStartEnd = { ...shot, gen_method: "I2V" as const };
    await expect(
      runStartEndShot({ dao: t.dao, runner, chain, api, manual }, notStartEnd, startEndInput),
    ).rejects.toThrow("START_END 샷이 아니다");
  });
});
