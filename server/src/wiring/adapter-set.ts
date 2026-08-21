/**
 * 어댑터 팩토리 (issue #10 접합) — settings KV(adapter_mode.*, tts_vendor)에 따라
 * API/MANUAL 어댑터를 고른다 (REQ-ADAPT-01: 설정으로 전환).
 *
 * - MANUAL 어댑터 4종은 싱글턴이다 — 잡 상태(지시서·드롭 대기)가 인메모리라
 *   드롭(onManualFiles)이 같은 인스턴스에 도달해야 한다.
 * - API 어댑터는 호출 시점에 생성한다(출력 디렉터리가 에피소드별로 다르다).
 *   키가 없으면 그 시점에 명확한 에러가 나며, MANUAL 모드는 env 를 건드리지 않는다.
 */

import type {
  AdapterMode,
  ImageAdapter,
  JobHandle,
  LLMAdapter,
  TTSAdapter,
  TTSVendor,
  VideoAdapter,
} from "@shortsrator/shared";
import { HiggsfieldClient } from "../adapters/higgsfield/client.js";
import { HiggsfieldImageAdapter } from "../adapters/image/higgsfield-image-adapter.js";
import { HiggsfieldVideoAdapter } from "../adapters/video/higgsfield-video-adapter.js";
import { ClaudeLLMAdapter } from "../adapters/llm/index.js";
import { createTTSAdapter } from "../adapters/tts/index.js";
import {
  ManualImageAdapter,
  ManualLLMAdapter,
  ManualTTSAdapter,
  ManualVideoAdapter,
} from "../adapters/manual/manual-adapters.js";
import type { Dao } from "../db/index.js";

/** jobs.adapter 컬럼에 기록할 이름과 인스턴스 쌍 */
export interface NamedAdapter<T> {
  adapter: T;
  name: string;
}

/** MANUAL 드롭을 받을 수 있는 최소 표면 — 어댑터별 출력 타입 차이를 지운다 */
export interface ManualDropTarget {
  attachFiles(handle: JobHandle, filePaths: string[]): Promise<unknown>;
}

const ADAPTER_MODE_KEY = (kind: string) => `adapter_mode.${kind}`;
const TTS_VENDOR_KEY = "tts_vendor";

const NO_API_VIDEO_MESSAGE =
  "video 어댑터가 MANUAL 모드다 — API 경로 없음(start_end 강등 체인이 manual 로 내려간다)";

/** MANUAL 모드에서 StartEndChain 의 api 자리에 꽂는 스텁 — 항상 거부해 manual 로 강등시킨다 */
export const NO_API_VIDEO: VideoAdapter = {
  mode: "api",
  poll: async () => {
    throw new Error(NO_API_VIDEO_MESSAGE);
  },
  i2v: async () => {
    throw new Error(NO_API_VIDEO_MESSAGE);
  },
  startEnd: async () => {
    throw new Error(NO_API_VIDEO_MESSAGE);
  },
  t2v: async () => {
    throw new Error(NO_API_VIDEO_MESSAGE);
  },
};

export class AdapterSet {
  /** MANUAL 어댑터 싱글턴 — 인메모리 잡 상태의 단일 보관처 */
  readonly manual = {
    llm: new ManualLLMAdapter(),
    tts: new ManualTTSAdapter(),
    image: new ManualImageAdapter(),
    video: new ManualVideoAdapter(),
  };

  // 캐시는 생성 당시 키 값과 함께 보관한다 — 웹 설정에서 키가 바뀌면(.env 기록 후
  // process.env 갱신, routes/settings.ts) 다음 호출에서 새 키로 재생성된다 (issue #11).
  private higgsfieldCache?: { keyId: string; secret: string; client: HiggsfieldClient };
  private claudeCache?: { apiKey: string; adapter: ClaudeLLMAdapter };

  constructor(
    private readonly dao: Dao,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** settings KV 의 어댑터 모드 — 기본값은 routes/settings.ts 와 동일하게 api */
  mode(kind: "llm" | "tts" | "image" | "video"): AdapterMode {
    return this.dao.settings.get(ADAPTER_MODE_KEY(kind)) === "manual"
      ? "manual"
      : "api";
  }

  private client(): HiggsfieldClient {
    const keyId = this.env.HF_API_KEY_ID ?? "";
    const secret = this.env.HF_API_SECRET ?? "";
    if (
      !this.higgsfieldCache ||
      this.higgsfieldCache.keyId !== keyId ||
      this.higgsfieldCache.secret !== secret
    ) {
      this.higgsfieldCache = {
        keyId,
        secret,
        client: HiggsfieldClient.fromEnv(this.env),
      };
    }
    return this.higgsfieldCache.client;
  }

  llm(): NamedAdapter<LLMAdapter> {
    if (this.mode("llm") === "manual") {
      return { adapter: this.manual.llm, name: "manual" };
    }
    const apiKey = this.env.ANTHROPIC_API_KEY ?? "";
    if (!this.claudeCache || this.claudeCache.apiKey !== apiKey) {
      this.claudeCache = {
        apiKey,
        adapter: new ClaudeLLMAdapter({ apiKey: this.env.ANTHROPIC_API_KEY }),
      };
    }
    return { adapter: this.claudeCache.adapter, name: "claude" };
  }

  tts(outputDir: string): NamedAdapter<TTSAdapter> {
    if (this.mode("tts") === "manual") {
      return { adapter: this.manual.tts, name: "manual" };
    }
    const vendor: TTSVendor =
      this.dao.settings.get(TTS_VENDOR_KEY) === "typecast"
        ? "typecast"
        : "elevenlabs";
    return { adapter: createTTSAdapter(vendor, { outputDir }), name: vendor };
  }

  image(outputDir: string): NamedAdapter<ImageAdapter> {
    if (this.mode("image") === "manual") {
      return { adapter: this.manual.image, name: "manual" };
    }
    return {
      adapter: new HiggsfieldImageAdapter({ client: this.client(), outputDir }),
      name: "higgsfield",
    };
  }

  video(outputDir: string): NamedAdapter<VideoAdapter> {
    if (this.mode("video") === "manual") {
      return { adapter: this.manual.video, name: "manual" };
    }
    return {
      adapter: new HiggsfieldVideoAdapter({ client: this.client(), outputDir }),
      name: "higgsfield",
    };
  }

  /** StartEndChain 의 frames/edit_splice 단계용 API 어댑터 — MANUAL 모드는 거부 스텁 */
  videoApiOrStub(outputDir: string): VideoAdapter {
    return this.mode("video") === "api"
      ? this.video(outputDir).adapter
      : NO_API_VIDEO;
  }

  /** MANUAL 드롭 라우팅 — jobs.kind 로 소유 MANUAL 어댑터를 찾는다 */
  manualByKind(kind: string): ManualDropTarget | undefined {
    if (kind === "script") return this.manual.llm;
    if (kind === "tts") return this.manual.tts;
    if (kind === "master_asset" || kind === "frame_gen") return this.manual.image;
    if (kind.startsWith("video")) return this.manual.video;
    return undefined;
  }
}
