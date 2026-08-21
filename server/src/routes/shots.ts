/** POST /api/shots/:id/adopt — GATE3 클립 채택 (in/out은 0.1초=100ms 단위 ms 정수). */
import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./context.js";

export function registerShotRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { dao, pipeline } = ctx;

  app.post("/api/shots/:id/adopt", async (request, reply) => {
    const { id } = request.params as { id: string };
    const shot = dao.shots.get(id);
    if (!shot) {
      return reply.code(404).send({ error: `샷 없음: ${id}` });
    }

    const body = (request.body ?? {}) as {
      assetId?: unknown;
      inMs?: unknown;
      outMs?: unknown;
    };
    if (typeof body.assetId !== "string" || body.assetId.length === 0) {
      return reply.code(400).send({ error: "assetId(문자열) 필수" });
    }
    if (
      !Number.isInteger(body.inMs) ||
      !Number.isInteger(body.outMs) ||
      (body.inMs as number) < 0 ||
      (body.outMs as number) <= (body.inMs as number)
    ) {
      return reply
        .code(400)
        .send({ error: "inMs/outMs는 ms 정수이고 outMs > inMs ≥ 0 이어야 한다" });
    }

    await pipeline.adoptClip(id, {
      assetId: body.assetId,
      inMs: body.inMs as number,
      outMs: body.outMs as number,
    });
    return { ok: true };
  });
}
