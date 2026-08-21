/**
 * Higgsfield 영상 어댑터 (API 모드) — I2V dop + motion 매핑 (docs/03-architecture.md).
 * REQ-VIDEO-01. startEnd(frames)는 신 API 표면
 * POST /higgsfield-ai/dop/{tier}/first-last-frame 으로 제출한다
 * (2026-08-21 frames 스모크 실측 — body: prompt, image_url, end_image_url,
 * motions:[{id,strength}]). 이미지 입력은 http/https URL만 허용되므로 로컬 경로는
 * 프리사인 업로드(client.uploadFile)를 거친다.
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
  type HiggsfieldDopTier,
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
  /** first-last-frame(신 표면) dop 티어 — 기본 lite (비용 최소) */
  tier?: HiggsfieldDopTier;
}

/** ms 정수(도메인 단위) → 벤더 초 단위 (최소 1초) */
export function msToDurationSec(duration_ms: number): number {
  return Math.max(1, Math.round(duration_ms / 1000));
}

/**
 * motions[].strength — 신 표면 스키마에서 필수(0~1, 기본값 없음, step 0.01).
 * 중간 강도를 기본으로 채택한다. 테마별 조정은 후속(실측 파일럿) 소관.
 */
export const DEFAULT_MOTION_STRENGTH = 0.5;

export class HiggsfieldVideoAdapter
  extends HiggsfieldJobAdapterBase<VideoOutput>
  implements VideoAdapter
{
  protected readonly defaultExtension = "mp4";
  readonly model: string;
  readonly tier: HiggsfieldDopTier;

  constructor(options: HiggsfieldVideoAdapterOptions) {
    super(options);
    this.model = options.model ?? HIGGSFIELD_I2V_MODEL;
    this.tier = options.tier ?? "lite";
  }

  /** http/https 는 그대로, 로컬 경로는 프리사인 업로드로 원격 URL을 만든다 */
  private async toRemoteUrl(pathOrUrl: string): Promise<string> {
    return /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : this.client.uploadFile(pathOrUrl);
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

  /**
   * frames 방식 — 신 표면 first-last-frame (스모크 실측 형식).
   * duration 파라미터는 신 표면에 없다(클립 길이 벤더 고정, 실측 ~5.4s) —
   * input.duration_ms 는 조립 단계 트림의 몫. 미지원 거부(4xx)는
   * start-end-chain이 edit_splice로 강등한다.
   */
  async startEnd(input: StartEndInput): Promise<JobHandle> {
    const [imageUrl, endImageUrl] = await Promise.all([
      this.toRemoteUrl(input.startFramePath),
      this.toRemoteUrl(input.endFramePath),
    ]);
    const payload: Record<string, unknown> = {
      prompt: input.motionPrompt,
      image_url: imageUrl,
      end_image_url: endImageUrl,
    };
    const motionId = resolveMotionId(input.motionPrompt);
    if (motionId !== undefined) {
      payload.motions = [{ id: motionId, strength: DEFAULT_MOTION_STRENGTH }];
    }
    const requestId = await this.client.submit(
      HIGGSFIELD_ENDPOINTS.dopFirstLastFrame(this.tier),
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
