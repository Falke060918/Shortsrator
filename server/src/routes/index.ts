/**
 * routes 공개 표면 — app.ts는 registerApiRoutes 하나만 호출한다.
 * /media 정적 서빙(읽기 전용·경로 순회 가드)도 여기서 등록한다.
 */
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { RouteContext } from "./context.js";
import { PipelineNotWiredError } from "./pipeline-service.js";
import { registerStateRoutes } from "./state.js";
import { registerEpisodeRoutes } from "./episodes.js";
import { registerShotRoutes } from "./shots.js";
import { registerManualRoutes } from "./manual.js";
import { registerSettingsRoutes } from "./settings.js";

export type { RouteContext } from "./context.js";
export {
  createNotWiredPipeline,
  PipelineNotWiredError,
  type PipelineService,
} from "./pipeline-service.js";
export { MANUAL_UPLOAD_EXTENSIONS } from "./manual.js";

export async function registerApiRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): Promise<void> {
  // 파이프라인 미배선(503) 매핑 — 나머지는 Fastify 기본 처리에 맡긴다.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PipelineNotWiredError) {
      return reply.code(503).send({ error: error.message });
    }
    throw error;
  });

  registerStateRoutes(app, ctx);
  registerEpisodeRoutes(app, ctx);
  registerShotRoutes(app, ctx);
  registerManualRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);

  // /media/* — workspace 정적 서빙(읽기 전용).
  // @fastify/static이 루트 밖 해석(경로 순회)을 차단하지만,
  // 완료 조건의 가드를 명시하기 위해 ".." 요청은 여기서도 403으로 끊는다.
  app.addHook("onRequest", async (request, reply) => {
    if (!request.raw.url?.startsWith("/media/")) return;
    const decoded = decodeURIComponent(request.raw.url);
    if (decoded.includes("..") || decoded.includes("\0")) {
      return reply.code(403).send({ error: "경로 순회 차단" });
    }
  });
  await app.register(fastifyStatic, {
    root: ctx.workspaceDir,
    prefix: "/media/",
    index: false,
    list: false,
    // web/dist 서빙 등록(app.ts)과의 reply 데코레이터 충돌 방지
    decorateReply: false,
  });
}
