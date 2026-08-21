/**
 * /api/episodes — 생성·상세·advance·gate·rollback·SSE 이벤트.
 * 상태 전이 로직은 전부 PipelineService에 위임하고 여기서는 검증·매핑만 한다.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AdvanceResponse,
  CostMeta,
  EpisodeDetailResponse,
  EpisodeState,
  GateDecisionValue,
  ServerEvent,
  ShotSpec,
  TransitionType,
} from "@shortsrator/shared";
import { EPISODE_STATES, GATES } from "@shortsrator/shared";
import type { EpisodeRow, ShotRow } from "../db/index.js";
import type { RouteContext } from "./context.js";

const STATE_SET = new Set<string>(EPISODE_STATES);
const GATE_SET = new Set<string>(GATES);
const DECISIONS = new Set<string>(["approve", "reject"]);

/** SSE 하트비트 간격(ms) — 프록시/브라우저 유휴 타임아웃 방지 */
const SSE_HEARTBEAT_MS = 15_000;

function parseJsonArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toShotSpec(row: ShotRow): ShotSpec {
  return {
    id: row.id,
    episode_id: row.episode_id,
    idx: row.idx,
    narration: row.narration,
    duration_ms: row.duration_ms,
    gen_method: row.gen_method,
    camera_moves: parseJsonArray(row.camera_moves_json),
    image_prompt: row.image_prompt,
    motion_prompt: row.motion_prompt,
    // DB는 START_END 외 샷에서 NULL 허용 — DTO(ShotSpec)는 필수라 'manual'로 채운다.
    transition_type: row.transition_type ?? "manual",
    fallback: parseJsonArray(row.fallback_json) as TransitionType[],
    adopted_asset_id: row.adopted_asset_id ?? undefined,
    adopted_in_ms: row.adopted_in_ms ?? undefined,
    adopted_out_ms: row.adopted_out_ms ?? undefined,
  };
}

function parseCost(costJson: string | null): CostMeta {
  if (!costJson) return {};
  try {
    return JSON.parse(costJson) as CostMeta;
  } catch {
    return {};
  }
}

export function registerEpisodeRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { dao, pipeline } = ctx;

  function requireEpisode(
    request: FastifyRequest,
    reply: FastifyReply,
  ): EpisodeRow | undefined {
    const { id } = request.params as { id: string };
    const episode = dao.episodes.get(id);
    if (!episode) {
      void reply.code(404).send({ error: `에피소드 없음: ${id}` });
      return undefined;
    }
    return episode;
  }

  // ---------------------------------------------------------- POST /api/episodes
  app.post("/api/episodes", async (request, reply) => {
    const body = (request.body ?? {}) as { topicId?: unknown };
    if (typeof body.topicId !== "string" || body.topicId.length === 0) {
      return reply.code(400).send({ error: "topicId(문자열) 필수" });
    }
    const topic = dao.topics.get(body.topicId);
    if (!topic) {
      return reply.code(404).send({ error: `주제 없음: ${body.topicId}` });
    }
    const theme = dao.themes.get(topic.theme_id);
    if (!theme?.current_version_id) {
      return reply
        .code(409)
        .send({ error: "테마에 확정 버전(current_version_id)이 없다" });
    }

    const id = randomUUID();
    dao.episodes.insert({
      id,
      theme_version_id: theme.current_version_id,
      topic_id: topic.id,
      state: "TOPIC",
      metrics_json: null,
      cost_json: null,
    });
    const created = dao.episodes.get(id);
    return reply.code(201).send({
      id,
      topicTitle: topic.title,
      state: "TOPIC" satisfies EpisodeState,
      updatedAt: created?.updated_at ?? "",
    });
  });

  // ---------------------------------------------------------- GET /api/episodes/:id
  app.get("/api/episodes/:id", async (request, reply) => {
    const episode = requireEpisode(request, reply);
    if (!episode) return;

    const detail: EpisodeDetailResponse = {
      id: episode.id,
      topicTitle: dao.topics.get(episode.topic_id)?.title ?? "",
      state: episode.state,
      shots: dao.shots.listByEpisode(episode.id).map(toShotSpec),
      gateHistory: dao.gateDecisions.listByEpisode(episode.id).map((g) => ({
        gate: g.gate,
        decision: g.decision,
        payload: g.payload_json ? (JSON.parse(g.payload_json) as unknown) : undefined,
        decidedAt: g.decided_at,
      })),
      cost: parseCost(episode.cost_json),
    };
    return detail;
  });

  // ---------------------------------------------------------- POST /api/episodes/:id/advance
  app.post("/api/episodes/:id/advance", async (request, reply) => {
    const episode = requireEpisode(request, reply);
    if (!episode) return;
    const result: AdvanceResponse = await pipeline.advance(episode.id);
    return result;
  });

  // ---------------------------------------------------------- POST /api/episodes/:id/gate
  app.post("/api/episodes/:id/gate", async (request, reply) => {
    const episode = requireEpisode(request, reply);
    if (!episode) return;
    const body = (request.body ?? {}) as {
      gate?: unknown;
      decision?: unknown;
      payload?: unknown;
    };
    if (typeof body.gate !== "string" || !GATE_SET.has(body.gate)) {
      return reply
        .code(400)
        .send({ error: `gate는 ${GATES.join("/")} 중 하나여야 한다` });
    }
    if (typeof body.decision !== "string" || !DECISIONS.has(body.decision)) {
      return reply
        .code(400)
        .send({ error: "decision은 approve/reject 중 하나여야 한다" });
    }
    return pipeline.decideGate(episode.id, {
      gate: body.gate as (typeof GATES)[number],
      decision: body.decision as GateDecisionValue,
      payload: body.payload,
    });
  });

  // ---------------------------------------------------------- POST /api/episodes/:id/rollback
  app.post("/api/episodes/:id/rollback", async (request, reply) => {
    const episode = requireEpisode(request, reply);
    if (!episode) return;
    const body = (request.body ?? {}) as { toState?: unknown };
    if (typeof body.toState !== "string" || !STATE_SET.has(body.toState)) {
      return reply
        .code(400)
        .send({ error: "toState는 에피소드 상태머신 값이어야 한다" });
    }
    return pipeline.rollback(episode.id, body.toState as EpisodeState);
  });

  // ---------------------------------------------------------- GET /api/episodes/:id/events
  // SSE 1채널(잡 진행·상태 전이). Accept가 text/event-stream이 아니면
  // 폴링 폴백용 상태 스냅샷(JSON)을 반환한다.
  app.get("/api/episodes/:id/events", (request, reply) => {
    const episode = requireEpisode(request, reply);
    if (!episode) return;

    const accept = request.headers.accept ?? "";
    if (!accept.includes("text/event-stream")) {
      return reply.send({
        episodeId: episode.id,
        state: episode.state,
        jobs: dao.jobs.listByEpisode(episode.id).map((j) => ({
          id: j.id,
          kind: j.kind,
          status: j.status,
        })),
      });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    const send = (event: ServerEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // 접속 즉시 현재 상태 1건 — 클라이언트가 초기 스냅샷 없이도 동기화된다.
    send({ type: "episode_state", episodeId: episode.id, state: episode.state });

    const unsubscribe = pipeline.subscribe(episode.id, send);
    const heartbeat = setInterval(() => {
      raw.write(": ping\n\n");
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      raw.end();
    });
  });
}
