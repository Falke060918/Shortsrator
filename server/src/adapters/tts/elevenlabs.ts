/**
 * ElevenLabs TTS 어댑터 — POST /v1/text-to-speech/{voice_id}, 응답은 mp3 바이너리.
 * 벤더 HTTP 는 이 파일 안에만 존재한다.
 */

import type { TTSSynthesizeInput } from "@shortsrator/shared";
import {
  HttpTTSAdapter,
  type TTSAdapterOptions,
  type TTSVendorRequest,
} from "./base.js";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export class ElevenLabsTTSAdapter extends HttpTTSAdapter {
  protected readonly apiKeyEnvName = "ELEVENLABS_API_KEY";

  constructor(options: TTSAdapterOptions = {}) {
    super(process.env.ELEVENLABS_API_KEY, options);
  }

  protected makeRequest(
    input: TTSSynthesizeInput,
    apiKey: string,
  ): TTSVendorRequest {
    return {
      url: `${API_BASE}/${encodeURIComponent(input.voice)}`,
      headers: { "xi-api-key": apiKey },
      body: {
        text: input.text,
        model_id: this.modelId ?? DEFAULT_MODEL_ID,
      },
      fileExtension: "mp3",
    };
  }
}
