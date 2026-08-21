import { describe, expect, it } from "vitest";
import { buildTestApp } from "./routes/test-utils.js";

describe("server 부팅", () => {
  it("GET /api/health 가 ok를 반환한다", async () => {
    const t = await buildTestApp();
    const res = await t.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await t.cleanup();
  });
});
