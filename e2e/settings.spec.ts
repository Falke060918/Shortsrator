/**
 * 설정 탭 실조작 e2e (issue #11) — 벤더 변경 저장·키 입력→설정됨 배지·값 미노출·삭제.
 * 서버 .env는 e2e 격리 파일(os.tmpdir()/shortsrator-e2e/.env) — start-server.mjs가 지정.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const ENV_FILE = path.join(os.tmpdir(), "shortsrator-e2e", ".env");
const SECRET = "sk-e2e-secret-abc123";

test("설정 탭 — 벤더 변경 저장, 키 입력→설정됨 배지, 값 재노출 없음, 빈 값 삭제", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /설정/ }).click();
  await expect(page.getByTestId("settings-screen")).toBeVisible();

  // 1) TTS 벤더 변경 → 저장 → 새로고침 후에도 유지
  await page.getByTestId("tts-vendor-typecast").click();
  await page.getByTestId("save-settings").click();
  await expect(page.getByTestId("settings-saved-msg")).toHaveText("저장됨");

  await page.reload();
  await page.getByRole("tab", { name: /설정/ }).click();
  await expect(page.getByTestId("tts-vendor-typecast")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 2) 키 입력 → 저장 → 배지 "설정됨" + 입력란 비움 (값 재표시 없음)
  await expect(page.getByTestId("key-status-ANTHROPIC_API_KEY")).toHaveText("누락");
  await page.getByTestId("key-input-ANTHROPIC_API_KEY").fill(SECRET);
  await page.getByTestId("save-keys").click();
  await expect(page.getByTestId("key-status-ANTHROPIC_API_KEY")).toHaveText("설정됨");
  await expect(page.getByTestId("key-input-ANTHROPIC_API_KEY")).toHaveValue("");

  // 3) 서버 .env에는 기록됐고, GET 응답 본문 어디에도 값이 없다
  expect(readFileSync(ENV_FILE, "utf8")).toContain(`ANTHROPIC_API_KEY=${SECRET}`);
  const res = await request.get("/api/settings");
  expect(res.ok()).toBe(true);
  const bodyText = await res.text();
  expect(bodyText).not.toContain(SECRET);
  expect(((await res.json()) as { apiKeys: Record<string, string> }).apiKeys.ANTHROPIC_API_KEY).toBe(
    "configured",
  );

  // 4) 삭제 → "누락" 배지 + .env 줄 제거
  await page.getByTestId("key-delete-ANTHROPIC_API_KEY").click();
  await expect(page.getByTestId("key-status-ANTHROPIC_API_KEY")).toHaveText("누락");
  expect(readFileSync(ENV_FILE, "utf8")).not.toContain(SECRET);
});
