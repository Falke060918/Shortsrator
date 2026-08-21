/**
 * Higgsfield 영상 어댑터 (API 모드) — I2V dop + motion_id (docs/03-architecture.md).
 * REQ-VIDEO-01. startEnd(frames)는 medias[] role 표기(start_image/end_image)로 제출한다
 * (docs/시작끝프레임처리 -claude.txt: role은 모델별 선언된 것만 유효 — 1일차 스모크로 판정).
 */

import type {
  I2VInput,
  JobHandle,
  StartEndInput,
  T2VInput,
  VideoAdapter,
  VideoOutput,
} from "@shortsrator/shared";
import {
  HIGGSFIELD_ENDPOINTS,
  HIGGSFIELD_I2V_MODEL,
} from "../higgsfield/client.js";
import {
  HiggsfieldJobAdapterBase,
  type HiggsfieldJobAdapterOptions,
} from "../higgsfield/job-adapter-base.js";
import { resolveMotionId } from "./motion-map.js";

export interface HiggsfieldVideoAdapterOptions
  extends HiggsfieldJobAdapterOptions {
  /** I2V/T2V 모델 — 기본 dop */
  model?: string;
}

/** ms 정수(도메인 단위) → 벤더 초 단위 (최소 1초) */
export function msToDurationSec(duration_ms: number): number {
  return Math.max(1, Math.round(duration_ms / 1000));
}

export class HiggsfieldVideoAdapter
  extends HiggsfieldJobAdapterBase<VideoOutput>
  implements VideoAdapter
{
  protected readonly defaultExtension = "mp4";
  readonly model: string;

  constructor(options: HiggsfieldVideoAdapterOptions) {
    super(options);
    this.model = options.model ?? HIGGSFIELD_I2V_MODEL;
  }

  async i2v(input: I2VInput): Promise<JobHandle> {
    const payload: Record<string, unknown> = {
      medias: [{ role: "image", url: input.imagePath }],
      motion_prompt: input.motionPrompt,
      duration_sec: msToDurationSec(input.duration_ms),
    };
    const motionId = resolveMotionId(input.motionPrompt);
    if (motionId !== undefined) payload.motion_id = motionId;
    const requestId = await this.client.submit(
      HIGGSFIELD_ENDPOINTS.image2video(this.model),
      payload,
    );
    return this.registerJob(requestId);
  }

  /** frames 방식 — 미지원 거부(4xx)는 start-end-chain이 edit_splice로 강등한다 */
  async startEnd(input: StartEndInput): Promise<JobHandle> {
    const payload: Record<string, unknown> = {
      medias: [
        { role: "start_image", url: input.startFramePath },
        { role: "end_image", url: input.endFramePath },
      ],
      motion_prompt: input.motionPrompt,
      duration_sec: msToDurationSec(input.duration_ms),
    };
    const motionId = resolveMotionId(input.motionPrompt);
    if (motionId !== undefined) payload.motion_id = motionId;
    const requestId = await this.client.submit(
      HIGGSFIELD_ENDPOINTS.image2video(this.model),
      payload,
    );
    return this.registerJob(requestId);
  }

  /** B-roll 전용 */
  async t2v(input: T2VInput): Promise<JobHandle> {
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      duration_sec: msToDurationSec(input.duration_ms),
    };
    const requestId = await this.client.submit(
      HIGGSFIELD_ENDPOINTS.text2video(this.model),
      payload,
    );
    return this.registerJob(requestId);
  }

  protected buildOutput(filePaths: string[]): VideoOutput {
    return { clipFilePaths: filePaths };
  }
}
