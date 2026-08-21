/**
 * Higgsfield 이미지/영상 어댑터 공통 골격 —
 * submit 시 로컬 jobId ↔ 벤더 request_id 매핑을 들고,
 * poll(handle) 1회 = 벤더 상태 1회 조회 + 완료 시 산출물 다운로드.
 *
 * 잡 영속화(jobs 테이블)는 db-layer/pipeline-engine 단위 소관 — 여기는
 * 인메모리 매핑만 둔다 (handle.requestId가 있으면 그것만으로도 폴링 가능).
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AdapterMode,
  CostMeta,
  JobHandle,
  JobSnapshot,
} from "@shortsrator/shared";
import { HiggsfieldApiError, HiggsfieldClient } from "./client.js";
import type { HiggsfieldRequestSnapshot } from "./client.js";

export type DownloadFn = (url: string, destPath: string) => Promise<void>;

export interface HiggsfieldJobAdapterOptions {
  client: HiggsfieldClient;
  /** 산출물을 저장할 디렉터리 (workspace/…/frames|clips 등) */
  outputDir: string;
  /** 테스트 주입용 — 기본 client.downloadTo */
  downloadFn?: DownloadFn;
  /** 크레딧 → 원화 환산 시세 (설정 시 cost.krw 병기) */
  krwPerCredit?: number;
}

export abstract class HiggsfieldJobAdapterBase<TOutput> {
  readonly mode: AdapterMode = "api";
  protected readonly client: HiggsfieldClient;
  protected readonly outputDir: string;
  private readonly downloadFn: DownloadFn;
  private readonly krwPerCredit?: number;
  private readonly requestIds = new Map<string, string>();

  /** 다운로드 파일 확장자 기본값 (URL에서 추출 실패 시) */
  protected abstract readonly defaultExtension: string;

  constructor(options: HiggsfieldJobAdapterOptions) {
    this.client = options.client;
    this.outputDir = options.outputDir;
    this.downloadFn =
      options.downloadFn ?? ((url, dest) => this.client.downloadTo(url, dest));
    this.krwPerCredit = options.krwPerCredit;
  }

  /** submit 결과를 JobHandle로 포장 */
  protected registerJob(requestId: string): JobHandle {
    const jobId = randomUUID();
    this.requestIds.set(jobId, requestId);
    return { jobId, requestId };
  }

  protected abstract buildOutput(filePaths: string[]): TOutput;

  async poll(handle: JobHandle): Promise<JobSnapshot<TOutput>> {
    const requestId = handle.requestId ?? this.requestIds.get(handle.jobId);
    if (!requestId) {
      throw new HiggsfieldApiError(
        `알 수 없는 잡 (${handle.jobId}): requestId 없음`,
      );
    }
    const snapshot = await this.client.getRequest(requestId);
    switch (snapshot.status) {
      case "queued":
        return { status: "queued" };
      case "in_progress":
        return { status: "running" };
      case "failed":
      case "nsfw":
        return {
          status: "failed",
          error: snapshot.error ?? `Higgsfield ${snapshot.status}`,
          cost: this.toCost(snapshot),
        };
      case "completed": {
        const filePaths = await this.downloadResults(handle.jobId, snapshot);
        return {
          status: "succeeded",
          output: this.buildOutput(filePaths),
          cost: this.toCost(snapshot),
        };
      }
    }
  }

  private async downloadResults(
    jobId: string,
    snapshot: HiggsfieldRequestSnapshot,
  ): Promise<string[]> {
    const filePaths: string[] = [];
    for (const [index, url] of snapshot.resultUrls.entries()) {
      const ext = extensionOf(url) ?? this.defaultExtension;
      const destPath = path.join(this.outputDir, `${jobId}-${index}.${ext}`);
      await this.downloadFn(url, destPath);
      filePaths.push(destPath);
    }
    return filePaths;
  }

  private toCost(snapshot: HiggsfieldRequestSnapshot): CostMeta | undefined {
    if (snapshot.credits === undefined) return undefined;
    const cost: CostMeta = { credits: snapshot.credits };
    if (this.krwPerCredit !== undefined) {
      cost.krw = Math.round(snapshot.credits * this.krwPerCredit);
    }
    return cost;
  }
}

function extensionOf(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace(".", "");
    return ext.length > 0 ? ext.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
