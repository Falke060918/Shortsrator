/**
 * TTS 벤더 선택 팩토리 — settings 의 TTS 벤더 값(shared TTSVendor)으로 어댑터를 고른다.
 * ElevenLabs·Typecast 둘 다 구현, 웹 설정에서 전환 (docs/03-architecture.md 채택안).
 */

import type { TTSAdapter, TTSVendor } from "@shortsrator/shared";
import type { TTSAdapterOptions } from "./base.js";
import { ElevenLabsTTSAdapter } from "./elevenlabs.js";
import { TypecastTTSAdapter } from "./typecast.js";

export function createTTSAdapter(
  vendor: TTSVendor,
  options: TTSAdapterOptions = {},
): TTSAdapter {
  switch (vendor) {
    case "elevenlabs":
      return new ElevenLabsTTSAdapter(options);
    case "typecast":
      return new TypecastTTSAdapter(options);
    default: {
      const exhausted: never = vendor;
      throw new Error(`지원하지 않는 TTS 벤더: ${String(exhausted)}`);
    }
  }
}

export { ElevenLabsTTSAdapter } from "./elevenlabs.js";
export { TypecastTTSAdapter } from "./typecast.js";
export type { TTSAdapterOptions } from "./base.js";
