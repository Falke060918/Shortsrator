import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { createDao, migrate, openDb, type Dao } from "./db/index.js";
import { registerApiRoutes, type PipelineService } from "./routes/index.js";
import { createWiredPipeline, ensureThemePresets } from "./wiring/index.js";

/** 로컬 1인 앱 — 외부 바인딩 금지 (docs/03-architecture.md 보안 경계) */
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);

/** MANUAL 드롭 업로드 상한 — 로컬 영상 파일 기준 넉넉히 */
const UPLOAD_FILE_SIZE_LIMIT = 512 * 1024 * 1024;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const webDistDir = path.join(repoRoot, "web", "dist");
const defaultWorkspaceDir = path.join(repoRoot, "workspace");

export interface BuildAppOptions {
  /** 테스트 주입용 — 미지정 시 workspaceDir의 SQLite 파일을 열어 마이그레이션한다. */
  dao?: Dao;
  /** 테스트 주입용 — 미지정 시 실배선(wiring/createWiredPipeline)을 조립한다 */
  pipeline?: PipelineService;
  /** workspace 루트 — /media 정적 서빙·MANUAL 드롭 저장 위치 */
  workspaceDir?: string;
  /** dao 미지정 시 열 DB 파일 경로 (기본: {workspace}/shortsrator.db) */
  dbPath?: string;
  /** 테마 프리셋 디렉터리 — 미지정 시 저장소 루트 presets/ */
  presetsDir?: string;
  /** API 키 기록 대상 .env — 미지정 시 저장소 루트 .env (e2e는 SHORTSRATOR_ENV_FILE로 격리) */
  envFilePath?: string;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  const workspaceDir =
    options.workspaceDir ??
    process.env.SHORTSRATOR_WORKSPACE_DIR ??
    defaultWorkspaceDir;
  mkdirSync(workspaceDir, { recursive: true });

  const envFilePath =
    options.envFilePath ??
    process.env.SHORTSRATOR_ENV_FILE ??
    path.join(repoRoot, ".env");

  let dao = options.dao;
  if (!dao) {
    const db = openDb(options.dbPath ?? path.join(workspaceDir, "shortsrator.db"));
    migrate(db);
    dao = createDao(db);
    app.addHook("onClose", async () => {
      db.close();
    });
  }
  // 실배선(issue #10): 프리셋 로드 → 실제 파이프라인 조립.
  // 상태 전이는 pipeline 배럴(PipelineEngine)만 경유한다 — 게이트 불가침 유지.
  let pipeline = options.pipeline;
  if (!pipeline) {
    ensureThemePresets(dao, options.presetsDir);
    pipeline = createWiredPipeline({ dao, workspaceDir });
  }

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(fastifyMultipart, {
    limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT, files: 20 },
  });
  await registerApiRoutes(app, { dao, pipeline, workspaceDir, envFilePath });

  // web/dist 정적 서빙 — 상시 실행은 동일 오리진(CORS 개방 없음), dev는 Vite 프록시.
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
