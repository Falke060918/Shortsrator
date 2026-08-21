import { randomUUID } from "node:crypto";
import type {
  AsyncJobAdapter,
  JobHandle,
  JobSnapshot,
} from "@shortsrator/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobFailedError, JobRunner } from "./job-runner.js";
import { openTestDb, seedEpisode, type TestDb } from "./test-fixtures.js";

interface FakeOutput {
  value: string;
}

/** 폴마다 스냅샷 대본을 하나씩 소비하는 가짜 어댑터 — 마지막 스냅샷은 반복 */
class ScriptedAdapter implements AsyncJobAdapter<FakeOutput> {
  readonly mode = "api" as const;
  polledKeys: string[] = [];
  private readonly scripts = new Map<string, JobSnapshot<FakeOutput>[]>();

  script(key: string, snapshots: JobSnapshot<FakeOutput>[]): void {
    this.scripts.set(key, [...snapshots]);
  }

  async submit(key: string): Promise<JobHandle> {
    return { jobId: randomUUID(), requestId: key };
  }

  async poll(handle: JobHandle): Promise<JobSnapshot<FakeOutput>> {
    const key = handle.requestId ?? handle.jobId;
    this.polledKeys.push(key);
    const script = this.scripts.get(key);
    if (!script || script.length === 0) {
      throw new Error(`대본 없는 잡: ${key}`);
    }
    return script.length > 1 ? script.shift()! : script[0];
  }
}

const immediateSleep = () => Promise.resolve();

let t: TestDb;
let runner: JobRunner;
let episodeId: string;
let adapter: ScriptedAdapter;

beforeEach(() => {
  t = openTestDb();
  runner = new JobRunner(t.dao, { sleep: immediateSleep });
  episodeId = seedEpisode(t.dao).episodeId;
  adapter = new ScriptedAdapter();
});

afterEach(() => {
  t.close();
});

describe("run — 제출·폴링·영속", () => {
  it("queued → running → succeeded 전이가 jobs 테이블에 남고 비용이 기록된다", async () => {
    adapter.script("req-1", [
      { status: "queued" },
      { status: "running" },
      {
        status: "succeeded",
        output: { value: "완료" },
        cost: { credits: 12, krw: 340 },
      },
    ]);

    const done = await runner.run(
      { episodeId, kind: "tts", adapter: "fake" },
      adapter,
      () => adapter.submit("req-1"),
    );

    expect(done.output).toEqual({ value: "완료" });
    const row = t.dao.jobs.get(done.jobId);
    expect(row?.status).toBe("succeeded");
    expect(row?.request_id).toBe("req-1");
    expect(row?.cost_credits).toBe(12);
    expect(row?.cost_krw).toBe(340);
  });

  it("payload 는 payload_json 으로 영속된다 (재개·재현의 원천)", async () => {
    adapter.script("req-p", [
      { status: "succeeded", output: { value: "ok" } },
    ]);
    const done = await runner.run(
      {
        episodeId,
        kind: "frame_gen",
        adapter: "fake",
        shotId: null,
        payload: { prompt: "판테온 외관" },
      },
      adapter,
      () => adapter.submit("req-p"),
    );
    const row = t.dao.jobs.get(done.jobId);
    expect(JSON.parse(row?.payload_json ?? "")).toEqual({ prompt: "판테온 외관" });
  });

  it("어댑터 실패 스냅샷은 failed + error 로 남고 JobFailedError 를 던진다", async () => {
    adapter.script("req-f", [
      { status: "running" },
      { status: "failed", error: "벤더 4xx", cost: { credits: 1 } },
    ]);
    await expect(
      runner.run({ episodeId, kind: "video_i2v", adapter: "fake" }, adapter, () =>
        adapter.submit("req-f"),
      ),
    ).rejects.toThrow(JobFailedError);
    const rows = t.dao.jobs.listByStatus("failed");
    expect(rows).toHaveLength(1);
    expect(rows[0].error).toBe("벤더 4xx");
    expect(rows[0].cost_credits).toBe(1);
  });

  it("submit 자체가 던지면 잡은 failed 로 정리된다", async () => {
    await expect(
      runner.run({ episodeId, kind: "tts", adapter: "fake" }, adapter, () =>
        Promise.reject(new Error("키 미설정")),
      ),
    ).rejects.toThrow(JobFailedError);
    expect(t.dao.jobs.listByStatus("failed")).toHaveLength(1);
  });

  it("manual_pending 은 실패가 아니다 — 드롭이 오면 succeeded 로 이어진다", async () => {
    adapter.script("req-m", [
      { status: "manual_pending" },
      { status: "manual_pending" },
      { status: "succeeded", output: { value: "드롭됨" }, cost: { krw: 0 } },
    ]);
    const done = await runner.run(
      { episodeId, kind: "video_start_end", adapter: "manual" },
      adapter,
      () => adapter.submit("req-m"),
    );
    expect(done.output).toEqual({ value: "드롭됨" });
    expect(t.dao.jobs.get(done.jobId)?.status).toBe("succeeded");
  });
});

describe("resume — 크래시 재개", () => {
  function insertCrashedJob(status: "queued" | "running" | "manual_pending", requestId: string | null): string {
    const id = randomUUID();
    t.dao.jobs.insert({
      id,
      episode_id: episodeId,
      shot_id: null,
      kind: "video_i2v",
      adapter: "fake",
      status,
      request_id: requestId,
      cost_credits: null,
      cost_krw: null,
      payload_json: JSON.stringify({ resumed: true }),
      error: null,
    });
    return id;
  }

  it("크래시 전 running 잡을 request_id 로 복원해 완주한다", async () => {
    const jobId = insertCrashedJob("running", "req-crash");
    // 크래시 후 새 프로세스: 새 러너 + 새 어댑터 인스턴스 (인메모리 상태 없음)
    const fresh = new ScriptedAdapter();
    fresh.script("req-crash", [
      { status: "running" },
      { status: "succeeded", output: { value: "재개 완료" }, cost: { krw: 500 } },
    ]);
    const freshRunner = new JobRunner(t.dao, { sleep: immediateSleep });

    const { resumed, abandoned } = freshRunner.resume(() => fresh);
    expect(abandoned).toHaveLength(0);
    expect(resumed).toHaveLength(1);
    const done = await resumed[0].completion;
    expect(done.output).toEqual({ value: "재개 완료" });
    expect(t.dao.jobs.get(jobId)?.status).toBe("succeeded");
    expect(t.dao.jobs.get(jobId)?.cost_krw).toBe(500);
    // 복원된 핸들이 request_id 를 그대로 썼는지
    expect(fresh.polledKeys.every((k) => k === "req-crash")).toBe(true);
  });

  it("manual_pending 잡도 재개 대상이다 — 드롭 후 속행", async () => {
    const jobId = insertCrashedJob("manual_pending", "manual-key");
    const fresh = new ScriptedAdapter();
    fresh.script("manual-key", [
      { status: "manual_pending" },
      { status: "succeeded", output: { value: "드롭" } },
    ]);
    const { resumed } = new JobRunner(t.dao, { sleep: immediateSleep }).resume(
      () => fresh,
    );
    await resumed[0].completion;
    expect(t.dao.jobs.get(jobId)?.status).toBe("succeeded");
  });

  it("어댑터를 해석할 수 없는 잡은 failed 로 정리된다 (영원한 대기 금지)", async () => {
    const jobId = insertCrashedJob("queued", null);
    const { resumed, abandoned } = runner.resume(() => undefined);
    expect(resumed).toHaveLength(0);
    expect(abandoned).toHaveLength(1);
    const row = t.dao.jobs.get(jobId);
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("재개 불가");
  });

  it("터미널(succeeded/failed) 잡은 재개 대상이 아니다", () => {
    const id = insertCrashedJob("running", "req-a");
    t.dao.jobs.updateStatus(id, "succeeded");
    const { resumed, abandoned } = runner.resume(() => adapter);
    expect(resumed).toHaveLength(0);
    expect(abandoned).toHaveLength(0);
  });
});
