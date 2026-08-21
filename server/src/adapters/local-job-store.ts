/**
 * 인메모리 잡 저장소 — shared/adapters.ts 의 비동기 잡 시맨틱스 구현체.
 * submit 계열 메서드는 즉시 JobHandle 을 반환하고, 호출자는 poll 로 스냅샷을 조회한다.
 * 벤더 호출이 동기 HTTP(Claude·ElevenLabs·Typecast)여도 같은 계약을 유지하기 위해
 * 작업을 백그라운드 프라미스로 돌리고 상태를 여기서 추적한다.
 * (영속화는 db-layer 의 jobs 테이블 몫 — 이 저장소는 어댑터 프로세스 수명 한정.)
 */

import { randomUUID } from "node:crypto";
import type { CostMeta, JobHandle, JobSnapshot } from "@shortsrator/shared";

export interface JobResult<TOutput> {
  output: TOutput;
  cost?: CostMeta;
}

export class LocalJobStore<TOutput> {
  private readonly jobs = new Map<string, JobSnapshot<TOutput>>();

  /** task 를 백그라운드로 실행하고 즉시 핸들을 반환한다. jobId 는 산출물 파일명 등에 쓸 수 있다. */
  run(task: (jobId: string) => Promise<JobResult<TOutput>>): JobHandle {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: "queued" });
    void (async () => {
      this.jobs.set(jobId, { status: "running" });
      try {
        const { output, cost } = await task(jobId);
        this.jobs.set(jobId, { status: "succeeded", output, cost });
      } catch (err) {
        this.jobs.set(jobId, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return { jobId };
  }

  /** 시작 전에 실패가 확정된 잡(API 키 미설정 등) — 핸들은 반환하되 곧장 failed 로 둔다. */
  failImmediately(error: string): JobHandle {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: "failed", error });
    return { jobId };
  }

  snapshot(handle: JobHandle): JobSnapshot<TOutput> {
    return (
      this.jobs.get(handle.jobId) ?? {
        status: "failed",
        error: `알 수 없는 잡: ${handle.jobId}`,
      }
    );
  }
}
