/**
 * GET/PUT /api/settings — 어댑터 모드·TTS 벤더·예산.
 * API 키 값 자체는 절대 응답에 싣지 않는다 — "configured"/"missing"만 (03-architecture 보안 경계).
 */
import type { FastifyInstance } from "fastify";
import type { AdapterMode, SettingsDTO, TTSVendor } from "@shortsrator/shared";
import type { Dao } from "../db/index.js";
import type { RouteContext } from "./context.js";

const ADAPTER_KINDS = ["llm", "tts", "image", "video"] as const;
type AdapterKind = (typeof ADAPTER_KINDS)[number];

const ADAPTER_MODES = new Set<string>(["api", "manual"]);
const TTS_VENDORS = new Set<string>(["elevenlabs", "typecast"]);

/** .env로만 관리되는 키 — 상태만 노출한다 (.env.example과 목록 일치). */
const API_KEY_ENV_VARS = [
  "HF_API_KEY_ID",
  "HF_API_SECRET",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "TYPECAST_API_KEY",
] as const;

const KEY_ADAPTER_MODE = (kind: AdapterKind) => `adapter_mode.${kind}`;
const KEY_TTS_VENDOR = "tts_vendor";
const KEY_BUDGET = "budget_krw_per_episode";

/** 편당 예산 기본값(원) — 목표 상한 (03-architecture 수용 리스크 절) */
const DEFAULT_BUDGET_KRW = 5000;

function readSettings(dao: Dao, env: NodeJS.ProcessEnv): SettingsDTO {
  const stored = dao.settings.all();
  const mode = (kind: AdapterKind): AdapterMode => {
    const value = stored[KEY_ADAPTER_MODE(kind)];
    return value === "manual" ? "manual" : "api";
  };
  const budget = Number(stored[KEY_BUDGET]);

  const apiKeys: Record<string, "configured" | "missing"> = {};
  for (const name of API_KEY_ENV_VARS) {
    apiKeys[name] = env[name] ? "configured" : "missing";
  }

  return {
    adapterModes: {
      llm: mode("llm"),
      tts: mode("tts"),
      image: mode("image"),
      video: mode("video"),
    },
    ttsVendor: stored[KEY_TTS_VENDOR] === "typecast" ? "typecast" : "elevenlabs",
    budgetKrwPerEpisode:
      Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_BUDGET_KRW,
    apiKeys,
  };
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { dao } = ctx;

  app.get("/api/settings", async (): Promise<SettingsDTO> => {
    return readSettings(dao, process.env);
  });

  app.put("/api/settings", async (request, reply) => {
    const body = (request.body ?? {}) as {
      adapterModes?: Partial<Record<AdapterKind, unknown>>;
      ttsVendor?: unknown;
      budgetKrwPerEpisode?: unknown;
    };

    if (body.adapterModes !== undefined) {
      for (const kind of ADAPTER_KINDS) {
        const value = body.adapterModes[kind];
        if (value === undefined) continue;
        if (typeof value !== "string" || !ADAPTER_MODES.has(value)) {
          return reply
            .code(400)
            .send({ error: `adapterModes.${kind}는 api/manual 중 하나여야 한다` });
        }
      }
    }
    if (
      body.ttsVendor !== undefined &&
      (typeof body.ttsVendor !== "string" || !TTS_VENDORS.has(body.ttsVendor))
    ) {
      return reply
        .code(400)
        .send({ error: "ttsVendor는 elevenlabs/typecast 중 하나여야 한다" });
    }
    if (
      body.budgetKrwPerEpisode !== undefined &&
      (typeof body.budgetKrwPerEpisode !== "number" ||
        !Number.isFinite(body.budgetKrwPerEpisode) ||
        body.budgetKrwPerEpisode <= 0)
    ) {
      return reply
        .code(400)
        .send({ error: "budgetKrwPerEpisode는 양수여야 한다" });
    }

    // 검증 통과분만 저장 — apiKeys는 PUT 대상이 아니다(.env로만 관리).
    if (body.adapterModes !== undefined) {
      for (const kind of ADAPTER_KINDS) {
        const value = body.adapterModes[kind];
        if (typeof value === "string") {
          dao.settings.set(KEY_ADAPTER_MODE(kind), value);
        }
      }
    }
    if (typeof body.ttsVendor === "string") {
      dao.settings.set(KEY_TTS_VENDOR, body.ttsVendor as TTSVendor);
    }
    if (typeof body.budgetKrwPerEpisode === "number") {
      dao.settings.set(KEY_BUDGET, String(body.budgetKrwPerEpisode));
    }

    return readSettings(dao, process.env);
  });
}
