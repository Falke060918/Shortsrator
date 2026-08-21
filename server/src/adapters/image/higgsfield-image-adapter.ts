/**
 * Higgsfield 이미지 어댑터 (API 모드) — T2I soul/flux (docs/03-architecture.md).
 * REQ-FRAME-01: 샷당 후보 2~4장 생성, 마스터 애셋 레퍼런스 입력.
 *
 * 레퍼런스 이미지의 API 노출은 미확인(03-architecture 수용 리스크) —
 * 페이로드에 실어 보내되, 거부 시 스모크로 판정하고 MANUAL로 강등한다.
 */

import type {
  ImageAdapter,
  ImageGenerateInput,
  ImageOutput,
  JobHandle,
} from "@shortsrator/shared";
import { HIGGSFIELD_ENDPOINTS } from "../higgsfield/client.js";
import type { HiggsfieldImageModel } from "../higgsfield/client.js";
import {
  HiggsfieldJobAdapterBase,
  type HiggsfieldJobAdapterOptions,
} from "../higgsfield/job-adapter-base.js";

/** 샷당 후보 장수 기본값 (01 문서 §4 STEP 5: 2~4장) */
export const DEFAULT_IMAGE_COUNT = 2;

export interface HiggsfieldImageAdapterOptions
  extends HiggsfieldJobAdapterOptions {
  /** T2I 모델 — 기본 soul */
  model?: HiggsfieldImageModel;
}

export class HiggsfieldImageAdapter
  extends HiggsfieldJobAdapterBase<ImageOutput>
  implements ImageAdapter
{
  protected readonly defaultExtension = "png";
  readonly model: HiggsfieldImageModel;

  constructor(options: HiggsfieldImageAdapterOptions) {
    super(options);
    this.model = options.model ?? "soul";
  }

  async generate(input: ImageGenerateInput): Promise<JobHandle> {
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: input.aspect,
      batch_size: input.count ?? DEFAULT_IMAGE_COUNT,
    };
    if (input.referenceImagePaths.length > 0) {
      payload.reference_images = input.referenceImagePaths;
    }
    const requestId = await this.client.submit(
      HIGGSFIELD_ENDPOINTS.text2image(this.model),
      payload,
    );
    return this.registerJob(requestId);
  }

  protected buildOutput(filePaths: string[]): ImageOutput {
    return { imageFilePaths: filePaths };
  }
}
