/**
 * MANUAL 어댑터 공통 골격 (REQ-ADAPT-01, shared/src/adapters.ts MANUAL 시맨틱스):
 *   submit → 즉시 manual_pending 잡 + 복붙 가능한 제작 지시서(instructions).
 *   파일 드롭(attachFiles — 추후 POST /api/manual/:jobId/files가 호출) →
 *   확장자 화이트리스트 검증 → succeeded 전이 → 파이프라인 속행.
 *
 * 검증 실패는 잡을 죽이지 않는다 — throw만 하고 manual_pending 유지 (재드롭 가능).
 * 잡 영속화(jobs 테이블)는 db-layer 소관, 여기는 인메모리.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AdapterMode,
  JobHandle,
  JobSnapshot,
  ManualInstructions,
} from "@shortsrator/shared";

/** 드롭 파일 검증 실패 — 잡은 manual_pending으로 남는다 (HTTP 레이어에서 400 매핑) */
export class ManualFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualFileValidationError";
  }
}

interface ManualJob<TOutput> {
  status: "manual_pending" | "succeeded";
  instructions: ManualInstructions;
  output?: TOutput;
}

export abstract class ManualAdapterBase<TOutput> {
  readonly mode: AdapterMode = "manual";
  private readonly jobs = new Map<string, ManualJob<TOutput>>();

  /** 드롭된 파일들로부터 어댑터별 출력 생성 */
  protected abstract buildOutput(filePaths: string[]): Promise<TOutput>;

  protected createJob(instructions: ManualInstructions): JobHandle {
    const jobId = randomUUID();
    this.jobs.set(jobId, { status: "manual_pending", instructions });
    return { jobId };
  }

  private getJob(jobId: string): ManualJob<TOutput> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`알 수 없는 MANUAL 잡: ${jobId}`);
    }
    return job;
  }

  async poll(handle: JobHandle): Promise<JobSnapshot<TOutput>> {
    const job = this.getJob(handle.jobId);
    if (job.status === "manual_pending") {
      return { status: "manual_pending", instructions: job.instructions };
    }
    return {
      status: "succeeded",
      output: job.output,
      // 수동 제작 — API 과금 없음을 명시적 0으로 기록 (편당 비용 집계 §10)
      cost: { credits: 0, krw: 0 },
    };
  }

  /**
   * 드롭 존 파일 인식 → 화이트리스트 검증 → succeeded 전이.
   * (업로드 저장 자체는 api-server의 multipart 소관 — 여기는 저장된 경로를 받는다)
   */
  async attachFiles(
    handle: JobHandle,
    filePaths: string[],
  ): Promise<JobSnapshot<TOutput>> {
    const job = this.getJob(handle.jobId);
    if (job.status !== "manual_pending") {
      throw new ManualFileValidationError(
        `이미 완료된 MANUAL 잡: ${handle.jobId}`,
      );
    }
    if (filePaths.length === 0) {
      throw new ManualFileValidationError("드롭된 파일이 없다");
    }
    const allowed = job.instructions.expectedFileExtensions.map((ext) =>
      ext.toLowerCase(),
    );
    for (const filePath of filePaths) {
      const ext = path.extname(filePath).replace(".", "").toLowerCase();
      if (!allowed.includes(ext)) {
        throw new ManualFileValidationError(
          `허용되지 않는 확장자 .${ext} (${filePath}) — 허용: ${allowed.join(", ")}`,
        );
      }
    }
    job.output = await this.buildOutput(filePaths);
    job.status = "succeeded";
    return this.poll(handle);
  }
}
