/**
 * Playwright e2e — 설정 탭 실조작 (issue #11).
 * 서버는 e2e/start-server.mjs가 격리 workspace/.env(os.tmpdir()/shortsrator-e2e)로 띄운다
 * — 실제 저장소 루트 .env는 절대 건드리지 않는다.
 */
import { defineConfig } from "@playwright/test";

const E2E_PORT = 8791;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // 로컬 단일 서버 공유 — 상태(설정 KV·.env)가 겹치지 않게 직렬 실행
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
  },
  webServer: {
    command: "npm run e2e:server",
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: String(E2E_PORT) },
  },
});
