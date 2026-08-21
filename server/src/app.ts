import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

/** 로컬 1인 앱 — 외부 바인딩 금지 (docs/03-architecture.md 보안 경계) */
const HOST = "127.0.0.1";
const PORT = 8787;

const webDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);

export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  // web/dist 정적 서빙 자리 — 상시 실행은 동일 오리진(CORS 개방 없음), dev는 Vite 프록시.
  // API 라우트 로직은 api-server 단위 범위라 여기서는 부팅과 정적 서빙까지만 둔다.
  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
  }

  return app;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await buildApp();
  try {
    await app.listen({ host: HOST, port: PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
