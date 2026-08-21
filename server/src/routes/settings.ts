/**
 * GET/PUT /api/settings — 어댑터 모드·TTS 벤더·예산·Higgsfield 티어.
 * PUT /api/settings/keys — API 키 기록(쓰기 전용, .env 반영 — issue #11).
 * API 키 값 자체는 절대 응답에 싣지 않는다 — "configured"/"missing"만 (03-architecture 보안 경계).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import {
  API_KEY_NAMES,
  type AdapterMode,
  type ApiKeyName,
  type HiggsfieldTier,
  type SettingsDTO,
  type TTSVendor,
} from "@shortsrator/shared";
import type { Dao } from "../db/index.js";
import type { RouteContext } from "./context.js";

const ADAPTER_KINDS = ["llm", "tts", "image", "video"] as const;
type AdapterKind = (typeof ADAPTER_KINDS)[number];

const ADAPTER_MODES = new Set<string>(["api", "manual"]);
const TTS_VENDORS = new Set<string>(["elevenlabs", "typecast"]);
const HIGGSFIELD_TIERS = new Set<string>(["lite", "standard", "high"]);

/** 키 이름 허용 목록 — .env.example 및 shared DTO와 일치 */
const API_KEY_SET = new Set<string>(API_KEY_NAMES);

const KEY_ADAPTER_MODE = (kind: AdapterKind) => `adapter_mode.${kind}`;
const KEY_TTS_VENDOR = "tts_vendor";
const KEY_BUDGET = "budget_krw_per_episode";
const KEY_HIGGSFIELD_TIER = "higgsfield_tier";

/** 편당 예산 기본값(원) — 목표 상한 (03-architecture 수용 리스크 절) */
const DEFAULT_BUDGET_KRW = 5000;

function readSettings(dao: Dao, env: NodeJS.ProcessEnv): SettingsDTO {
  const stored = dao.settings.all();
  const mode = (kind: AdapterKind): AdapterMode => {
    const value = stored[KEY_ADAPTER_MODE(kind)];
    return value === "manual" ? "manual" : "api";
  };
  const budget = Number(stored[KEY_BUDGET]);
  const tier = stored[KEY_HIGGSFIELD_TIER];

  const apiKeys: Record<string, "configured" | "missing"> = {};
  for (const name of API_KEY_NAMES) {
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
    higgsfieldTier:
      tier !== undefined && HIGGSFIELD_TIERS.has(tier)
        ? (tier as HiggsfieldTier)
        : "standard",
    apiKeys,
  };
}

/**
 * .env 내용에 키 갱신분을 반영한다 — 기존 줄 교체, 없으면 추가, 빈 값이면 삭제.
 * 주석·무관한 줄은 그대로 보존한다.
 */
export function applyEnvUpdates(
  content: string,
  updates: Record<string, string>,
): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  // 끝의 빈 줄은 떼어놨다가 마지막에 단일 개행으로 정리한다
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const pending = new Map(Object.entries(updates));
  const next: string[] = [];
  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const name = match?.[1];
    if (name !== undefined && pending.has(name)) {
      const value = pending.get(name)!;
      pending.delete(name);
      if (value === "") continue; // 삭제 — 줄 제거
      next.push(`${name}=${value}`);
      continue;
    }
    next.push(line);
  }
  for (const [name, value] of pending) {
    if (value === "") continue; // 없는 키 삭제 요청 — 무시
    next.push(`${name}=${value}`);
  }
  return next.length > 0 ? `${next.join("\n")}\n` : "";
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
      higgsfieldTier?: unknown;
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
    if (
      body.higgsfieldTier !== undefined &&
      (typeof body.higgsfieldTier !== "string" ||
        !HIGGSFIELD_TIERS.has(body.higgsfieldTier))
    ) {
      return reply
        .code(400)
        .send({ error: "higgsfieldTier는 lite/standard/high 중 하나여야 한다" });
    }

    // 검증 통과분만 저장 — apiKeys는 PUT /api/settings 대상이 아니다(키 기록은 /keys).
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
    if (typeof body.higgsfieldTier === "string") {
      dao.settings.set(KEY_HIGGSFIELD_TIER, body.higgsfieldTier);
    }

    return readSettings(dao, process.env);
  });

  // 키 기록 — 쓰기 전용. 값은 .env에만 남고 응답 어디에도 되돌아오지 않는다.
  // 빈 문자열 = 해당 키 삭제 (03-architecture 보안 경계, 2026-08-21 완화 결정).
  app.put("/api/settings/keys", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;

    const updates: Record<string, string> = {};
    for (const [name, value] of Object.entries(body)) {
      if (!API_KEY_SET.has(name)) {
        return reply.code(400).send({ error: `허용되지 않는 키 이름: ${name}` });
      }
      if (typeof value !== "string") {
        return reply.code(400).send({ error: `${name} 값은 문자열이어야 한다` });
      }
      const trimmed = value.trim();
      // 개행 금지 — .env 줄 구조 주입 차단
      if (/[\r\n]/.test(value)) {
        return reply.code(400).send({ error: `${name} 값에 개행을 넣을 수 없다` });
      }
      updates[name] = trimmed;
    }

    if (Object.keys(updates).length > 0) {
      const existing = existsSync(ctx.envFilePath)
        ? readFileSync(ctx.envFilePath, "utf8")
        : "";
      writeFileSync(ctx.envFilePath, applyEnvUpdates(existing, updates), "utf8");

      // process.env 즉시 반영 — 어댑터 팩토리(AdapterSet)는 env 값 변화를 감지해
      // API 클라이언트를 재생성한다(캐시 무효화, wiring/adapter-set.ts).
      for (const [name, value] of Object.entries(updates)) {
        if (value === "") delete process.env[name as ApiKeyName];
        else process.env[name as ApiKeyName] = value;
      }
    }

    return readSettings(dao, process.env);
  });
}
