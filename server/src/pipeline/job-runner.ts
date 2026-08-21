/**
 * 인프로세스 잡 러너 — jobs 테이블(수정 2)이 원천인 영속 실행기.
 *
 * - submit 계열은 어댑터 인터페이스(shared/src/adapters.ts)로만 호출한다 —
 *   벤더 SDK는 어댑터 안에만 존재한다.
 * - 상태 전이(queued → running/manual_pending → succeeded/failed)를 매 폴마다
 *   jobs 테이블에 반영한다 — 크래시 후에도 마지막 상태가 남는다.
 * - request_id 컬럼에는 어댑터 측 핸들 키(벤더 request_id 또는 어댑터 로컬 jobId)를
 *   저장한다. resume() 은 이 값으로 JobHandle 을 복원해 폴링을 이어간다 —
 *   Higgsfield 는 requestId 만으로 폴링 가능, MANUAL 은 jobId 로 폴링한다.
 * - 완료 시 비용 메타(cost_credits/cost_krw)를 기록한다 — 편당 비용 집계(§10)의 원천.
 *
 * 트랜잭션 주의: DAO 호출을 바깥 db.transaction 으로 감싸지 않는다 —
 * db.ts 의 transaction 은 bare BEGIN/COMMIT 이라 중첩 불가.
 */

import { randomUUID } from "node:crypto";
import type {
  AsyncJobAdapter,
  CostMeta,
  JobHandle,
  JobStatus,
} from "@shortsrator/shared";
import type { Dao, JobRow } from "../db/dao.js";

/** 잡 실행 명세 — payload 는 재개·재현을 위해 payload_json 으로 영속된다 */
export interface JobSpec {
  /** 미지정 시 randomUUID */
  id?: string;
  episodeId: string;
  shotId?: string | null;
  /** 단계 종류 (tts / frame_gen / video_i2v / video_start_end …) */
  kind: string;
  /** 어댑터 식별자 (elevenlabs / higgsfield / manual …) */
  adapter: string;
  payload?: unknown;
}

export interface CompletedJob<TOutput> {
  jobId: string;
  output: TOutput;
  cost?: CostMeta;
}

/** 잡 실패 — jobs 테이블에는 failed + error 가 이미 기록된 뒤 던져진다 */
export class JobFailedError extends Error {
  constructor(readonly jobId: string, message: string) {
    super(`잡 실패 (${jobId}): ${message}`);
    this.name = "JobFailedError";
  }
}

/** 크래시 재개 대상 상태 — 터미널(succeeded/failed) 이외 전부 */
export const RESUMABLE_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "manual_pending",
];

/** resume 시 잡 행 → 폴링할 어댑터 인스턴스 해석 (kind/adapter 기준) */
export type AdapterResolver = (job: JobRow) => AsyncJobAdapter<unknown> | undefined;

export interface ResumeResult {
  /** 폴링을 재개한 잡 — completion 은 터미널 도달 시 결정된다 */
  resumed: { job: JobRow; completion: Promise<CompletedJob<unknown>> }[];
  /** 어댑터를 해석하지 못해 failed 처리한 잡 */
  abandoned: JobRow[];
}

export interface JobRunnerOptions {
  /** 벤더 폴링 주기 (기본 2000ms — 03-architecture) */
  pollIntervalMs?: number;
  /** 테스트 주입용 대기 함수 */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class JobRunner {
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly dao: Dao,
    options: JobRunnerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * 잡 행 생성(queued) → submit → 핸들 영속 → 터미널까지 폴링.
   * manual_pending 은 실패가 아니다 — 드롭이 올 때까지 폴링을 계속한다.
   */
  async run<TOutput>(
    spec: JobSpec,
    adapter: AsyncJobAdapter<TOutput>,
    submit: () => Promise<JobHandle>,
  ): Promise<CompletedJob<TOutput>> {
    const jobId = this.insertJob(spec);
    let handle: JobHandle;
    try {
      handle = await submit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.dao.jobs.updateStatus(jobId, "failed", message);
      throw new JobFailedError(jobId, message);
    }
    this.persistHandle(jobId, handle);
    return this.track(jobId, handle, adapter);
  }

  /** 이미 제출된 핸들(예: StartEndChain 산출)을 잡 행으로 영속하고 추적한다 */
  async attach<TOutput>(
    spec: JobSpec,
    adapter: AsyncJobAdapter<TOutput>,
    handle: JobHandle,
  ): Promise<CompletedJob<TOutput>> {
    const jobId = this.insertJob(spec);
    this.persistHandle(jobId, handle);
    return this.track(jobId, handle, adapter);
  }

  /**
   * 크래시 재개 — 터미널이 아닌 잡 전부의 핸들을 request_id 로 복원해
   * 폴링을 이어간다. 어댑터를 해석할 수 없는 잡은 failed 로 정리한다
   * (영원히 재개 대기로 남기지 않는다).
   */
  resume(resolveAdapter: AdapterResolver): ResumeResult {
    const resumed: ResumeResult["resumed"] = [];
    const abandoned: JobRow[] = [];
    for (const status of RESUMABLE_STATUSES) {
      for (const job of this.dao.jobs.listByStatus(status)) {
        const adapter = resolveAdapter(job);
        if (!adapter) {
          this.dao.jobs.updateStatus(
            job.id,
            "failed",
            `재개 불가: 어댑터 해석 실패 (${job.adapter}/${job.kind})`,
          );
          abandoned.push(job);
          continue;
        }
        const handle: JobHandle = {
          jobId: job.request_id ?? job.id,
          requestId: job.request_id ?? undefined,
        };
        resumed.push({ job, completion: this.track(job.id, handle, adapter) });
      }
    }
    return { resumed, abandoned };
  }

  private insertJob(spec: JobSpec): string {
    const jobId = spec.id ?? randomUUID();
    this.dao.jobs.insert({
      id: jobId,
      episode_id: spec.episodeId,
      shot_id: spec.shotId ?? null,
      kind: spec.kind,
      adapter: spec.adapter,
      status: "queued",
      request_id: null,
      cost_credits: null,
      cost_krw: null,
      payload_json: spec.payload === undefined ? null : JSON.stringify(spec.payload),
      error: null,
    });
    return jobId;
  }

  private persistHandle(jobId: string, handle: JobHandle): void {
    // 어댑터 측 핸들 키 — 크래시 후 JobHandle 복원의 원천
    this.dao.jobs.setRequestId(jobId, handle.requestId ?? handle.jobId);
  }

  private async track<TOutput>(
    jobId: string,
    handle: JobHandle,
    adapter: AsyncJobAdapter<TOutput>,
  ): Promise<CompletedJob<TOutput>> {
    let lastStatus: JobStatus = "queued";
    for (;;) {
      let snapshot;
      try {
        snapshot = await adapter.poll(handle);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.dao.jobs.updateStatus(jobId, "failed", message);
        throw new JobFailedError(jobId, message);
      }

      if (snapshot.status === "succeeded") {
        this.persistCost(jobId, snapshot.cost);
        this.dao.jobs.updateStatus(jobId, "succeeded");
        return { jobId, output: snapshot.output as TOutput, cost: snapshot.cost };
      }
      if (snapshot.status === "failed") {
        this.persistCost(jobId, snapshot.cost);
        const message = snapshot.error ?? "원인 미상";
        this.dao.jobs.updateStatus(jobId, "failed", message);
        throw new JobFailedError(jobId, message);
      }

      if (snapshot.status !== lastStatus) {
        this.dao.jobs.updateStatus(jobId, snapshot.status);
        lastStatus = snapshot.status;
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private persistCost(jobId: string, cost: CostMeta | undefined): void {
    if (!cost) return;
    this.dao.jobs.setCost(jobId, cost.credits ?? null, cost.krw ?? null);
  }
}
