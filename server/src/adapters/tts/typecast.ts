/**
 * Typecast TTS 어댑터 — 개발자 API POST /v1/text-to-speech, 응답은 wav 바이너리.
 * 벤더 HTTP 는 이 파일 안에만 존재한다.
 */

import type { TTSSynthesizeInput } from "@shortsrator/shared";
import {
  HttpTTSAdapter,
  type TTSAdapterOptions,
  type TTSVendorRequest,
} from "./base.js";

const API_URL = "https://api.typecast.ai/v1/text-to-speech";
const DEFAULT_MODEL = "ssfm-v21";

export class TypecastTTSAdapter extends HttpTTSAdapter {
  protected readonly apiKeyEnvName = "TYPECAST_API_KEY";

  constructor(options: TTSAdapterOptions = {}) {
    super(process.env.TYPECAST_API_KEY, options);
  }

  protected makeRequest(
    input: TTSSynthesizeInput,
    apiKey: string,
  ): TTSVendorRequest {
    return {
      url: API_URL,
      headers: { "X-API-KEY": apiKey },
      body: {
        voice_id: input.voice,
        text: input.text,
        model: this.modelId ?? DEFAULT_MODEL,
      },
      fileExtension: "wav",
    };
  }
}
