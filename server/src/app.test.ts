import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("server 부팅", () => {
  it("GET /api/health 가 ok를 반환한다", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
