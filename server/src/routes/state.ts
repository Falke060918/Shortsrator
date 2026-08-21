/** GET /api/state — 대시보드 집계(에피소드 + 대기 게이트 + 주제 큐). */
import type { FastifyInstance } from "fastify";
import type {
  Gate,
  PendingGate,
  StateResponse,
  TopicSummary,
} from "@shortsrator/shared";
import { GATES } from "@shortsrator/shared";
import type { RouteContext } from "./context.js";

const GATE_SET = new Set<string>(GATES);

export function registerStateRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  app.get("/api/state", async (): Promise<StateResponse> => {
    const { dao } = ctx;

    const episodes = dao.episodes.list().map((e) => ({
      id: e.id,
      topicTitle: dao.topics.get(e.topic_id)?.title ?? "",
      state: e.state,
      updatedAt: e.updated_at,
    }));

    // 대기 게이트: 상태 문자열이 게이트 이름과 같은 에피소드가 그 게이트에서 대기 중이다.
    const pendingGates: PendingGate[] = dao.episodes
      .list()
      .filter((e) => GATE_SET.has(e.state))
      .map((e) => ({
        episodeId: e.id,
        gate: e.state as Gate,
        since: e.updated_at,
      }));

    const topicQueue: TopicSummary[] = dao.themes.list().flatMap((theme) =>
      dao.topics.listByTheme(theme.id).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    );

    return { episodes, pendingGates, topicQueue };
  });
}
