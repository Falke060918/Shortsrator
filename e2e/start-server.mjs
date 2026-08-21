/**
 * e2e 전용 서버 부트 — 격리 디렉터리(os.tmpdir()/shortsrator-e2e)를 매 실행 초기화하고,
 * web 번들을 빌드한 뒤 Fastify를 SHORTSRATOR_* 오버라이드로 띄운다.
 * 실제 저장소 루트 .env / workspace 는 건드리지 않는다 (03-architecture 보안 경계).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const e2eDir = path.join(os.tmpdir(), "shortsrator-e2e");
rmSync(e2eDir, { recursive: true, force: true });
mkdirSync(e2eDir, { recursive: true });

const build = spawnSync("npm", ["run", "build", "-w", "web"], {
  stdio: "inherit",
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const child = spawn("npx", ["tsx", "server/src/app.ts"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PORT: process.env.PORT ?? "8791",
    SHORTSRATOR_WORKSPACE_DIR: path.join(e2eDir, "workspace"),
    SHORTSRATOR_ENV_FILE: path.join(e2eDir, ".env"),
    NODE_ENV: "test",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
