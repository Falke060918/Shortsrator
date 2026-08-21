/**
 * api-server 통합테스트 (#9) — inject 기반 + SSE는 실서버(127.0.0.1) 수신.
 * 파이프라인은 MockPipeline 주입 — 실배선은 #10 pilot-integration 소관.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "./test-utils.js";

let t: TestApp;

beforeEach(async () => {
  t = await buildTestApp();
});

afterEach(async () => {
  await t.cleanup();
});

// ---------------------------------------------------------------- GET /api/state

describe("GET /api/state", () => {
  it("에피소드·대기 게이트·주제 큐를 집계한다", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/state" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.episodes).toEqual([
      expect.objectContaining({
        id: "ep1",
        topicTitle: "판테온",
        state: "SCRIPT_GATE",
      }),
    ]);
    expect(body.pendingGates).toEqual([
      expect.objectContaining({ episodeId: "ep1", gate: "SCRIPT_GATE" }),
    ]);
    expect(body.topicQueue).toEqual([
      expect.objectContaining({ id: "tp1", title: "판테온", status: "QUEUED" }),
    ]);
  });
});

// ---------------------------------------------------------------- /api/episodes

describe("POST /api/episodes", () => {
  it("주제로 에피소드를 TOPIC 상태로 생성한다", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/episodes",
      payload: { topicId: "tp1" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.state).toBe("TOPIC");
    expect(t.dao.episodes.get(body.id)?.state).toBe("TOPIC");
  });

  it("없는 주제는 404", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/episodes",
      payload: { topicId: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("topicId 누락은 400", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/episodes",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/episodes/:id", () => {
  it("샷(JSON 파싱)·게이트 이력·비용을 담은 상세를 반환한다", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/episodes/ep1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.topicTitle).toBe("판테온");
    expect(body.shots).toHaveLength(1);
    expect(body.shots[0].camera_moves).toEqual(["dolly_in"]);
    expect(body.shots[0].duration_ms).toBe(3200);
    expect(body.gateHistory).toEqual([
      expect.objectContaining({
        gate: "SCRIPT_GATE",
        decision: "reject",
        payload: { note: "2문장 압축" },
      }),
    ]);
    expect(body.cost).toEqual({ credits: 12, krw: 3400 });
  });

  it("없는 에피소드는 404", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/episodes/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------- advance / gate / rollback / adopt

describe("파이프라인 위임 엔드포인트", () => {
  it("advance는 파이프라인 결과를 그대로 반환한다", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/episodes/ep1/advance",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: "SCRIPT", jobId: "job-adv-1" });
    expect(t.pipeline.calls).toEqual([
      { method: "advance", args: ["ep1"] },
    ]);
  });

  it("gate 승인/반려를 파이프라인에 위임한다", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/episodes/ep1/gate",
      payload: { gate: "SCRIPT_GATE", decision: "approve" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: "TTS" });
    expect(t.pipeline.calls[0]).toEqual({
      method: "decideGate",
      args: ["ep1", { gate: "SCRIPT_GATE", decision: "approve", payload: undefined }],
    });
  });

  it("잘못된 gate/decision은 400", async () => {
    const bad1 = await t.app.inject({
      method: "POST",
      url: "/api/episodes/ep1/gate",
      payload: { gate: "NOT_A_GATE", decision: "approve" },
    });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await t.app.inject({
      method: "POST",
      url: "/api/episodes/ep1/gate",
      payload: { gate: "SCRIPT_GATE", decision: "maybe" },
    });
    expect(bad2.statusCode).toBe(400);
  });

  it("rollback은 상태머신 값만 받는다", async () => {
    const ok = await t.app.inject({
      method: "POST",
      url: "/api/episodes/ep1/rollback",
      payload: { toState: "SCRIPT" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ state: "SCRIPT" });

    const bad = await t.app.inject({
      method: "POST",
      url: "/api/episodes/ep1/rollback",
      payload: { toState: "NOT_A_STATE" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("adopt는 검증 후 파이프라인에 위임한다", async () => {
    const ok = await t.app.inject({
      method: "POST",
      url: "/api/shots/sh1/adopt",
      payload: { assetId: "as1", inMs: 100, outMs: 3200 },
    });
    expect(ok.statusCode).toBe(200);
    expect(t.pipeline.calls[0]).toEqual({
      method: "adoptClip",
      args: ["sh1", { assetId: "as1", inMs: 100, outMs: 3200 }],
    });

    const badRange = await t.app.inject({
      method: "POST",
      url: "/api/shots/sh1/adopt",
      payload: { assetId: "as1", inMs: 3200, outMs: 100 },
    });
    expect(badRange.statusCode).toBe(400);

    const noShot = await t.app.inject({
      method: "POST",
      url: "/api/shots/nope/adopt",
      payload: { assetId: "as1", inMs: 0, outMs: 100 },
    });
    expect(noShot.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------- SSE + 폴링 폴백

describe("GET /api/episodes/:id/events", () => {
  it("Accept가 SSE가 아니면 폴링 폴백용 상태 스냅샷(JSON)을 준다", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/episodes/ep1/events",
      headers: { accept: "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe("SCRIPT_GATE");
    expect(body.jobs).toEqual([
      expect.objectContaining({ id: "job1", status: "manual_pending" }),
    ]);
  });

  it("SSE로 초기 상태와 파이프라인 발행 이벤트를 수신한다", async () => {
    await t.app.listen({ host: "127.0.0.1", port: 0 });
    const address = t.app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("주소 확인 실패");
    }

    const controller = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${address.port}/api/episodes/ep1/events`,
      { headers: { accept: "text/event-stream" }, signal: controller.signal },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!received.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`SSE 수신 타임아웃: ${needle}`);
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
    };

    await readUntil('"episode_state"');
    expect(received).toContain('"state":"SCRIPT_GATE"');

    t.pipeline.emit("ep1", {
      type: "job_progress",
      jobId: "job1",
      status: "running",
    });
    await readUntil('"job_progress"');
    expect(received).toContain('"jobId":"job1"');

    controller.abort();
  });
});

// ---------------------------------------------------------------- MANUAL 드롭 업로드

function multipartPayload(files: Array<{ name: string; content: string }>) {
  const boundary = "----shortsratorTestBoundary";
  const parts = files.flatMap((f) => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${f.name}"`,
    "Content-Type: application/octet-stream",
    "",
    f.content,
  ]);
  return {
    payload: [...parts, `--${boundary}--`, ""].join("\r\n"),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("POST /api/manual/:jobId/files", () => {
  it("화이트리스트 파일을 workspace/manual/{jobId}/에 저장하고 파이프라인에 알린다", async () => {
    const { payload, headers } = multipartPayload([
      { name: "script.txt", content: "대본 텍스트" },
      { name: "voice.mp3", content: "mp3-bytes" },
    ]);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/manual/job1/files",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().saved).toEqual([
      "manual/job1/script.txt",
      "manual/job1/voice.mp3",
    ]);
    expect(t.pipeline.calls[0].method).toBe("onManualFiles");
    expect(t.pipeline.calls[0].args[0]).toBe("job1");
    expect(t.pipeline.calls[0].args[1]).toEqual([
      path.join(t.workspaceDir, "manual", "job1", "script.txt"),
      path.join(t.workspaceDir, "manual", "job1", "voice.mp3"),
    ]);
  });

  it("화이트리스트 밖 확장자는 400이고 파이프라인 통지가 없다", async () => {
    const { payload, headers } = multipartPayload([
      { name: "evil.exe", content: "MZ" },
    ]);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/manual/job1/files",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(t.pipeline.calls).toHaveLength(0);
  });

  it("없는 잡은 404", async () => {
    const { payload, headers } = multipartPayload([
      { name: "a.txt", content: "x" },
    ]);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/manual/nope/files",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------- 설정

describe("/api/settings", () => {
  it("GET은 기본값 + 키 상태(configured/missing)만 노출한다", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-super-secret";
    delete process.env.TYPECAST_API_KEY;
    try {
      const res = await t.app.inject({ method: "GET", url: "/api/settings" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.adapterModes).toEqual({
        llm: "api",
        tts: "api",
        image: "api",
        video: "api",
      });
      expect(body.ttsVendor).toBe("elevenlabs");
      expect(body.budgetKrwPerEpisode).toBe(5000);
      expect(body.apiKeys.ANTHROPIC_API_KEY).toBe("configured");
      expect(body.apiKeys.TYPECAST_API_KEY).toBe("missing");
      // 키 값 자체는 어디에도 실리면 안 된다
      expect(res.body).not.toContain("sk-test-super-secret");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("PUT은 검증 후 저장하고 갱신본을 돌려준다", async () => {
    const res = await t.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        adapterModes: { video: "manual" },
        ttsVendor: "typecast",
        budgetKrwPerEpisode: 4000,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.adapterModes.video).toBe("manual");
    expect(body.adapterModes.llm).toBe("api");
    expect(body.ttsVendor).toBe("typecast");
    expect(body.budgetKrwPerEpisode).toBe(4000);

    // 재조회에도 유지된다
    const again = await t.app.inject({ method: "GET", url: "/api/settings" });
    expect(again.json().ttsVendor).toBe("typecast");
  });

  it("잘못된 값은 400", async () => {
    const badMode = await t.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { adapterModes: { llm: "auto" } },
    });
    expect(badMode.statusCode).toBe(400);

    const badBudget = await t.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { budgetKrwPerEpisode: -1 },
    });
    expect(badBudget.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------- /media 정적 서빙

describe("GET /media/*", () => {
  it("workspace 파일을 읽기 전용으로 서빙한다", async () => {
    mkdirSync(path.join(t.workspaceDir, "clips"), { recursive: true });
    writeFileSync(path.join(t.workspaceDir, "clips", "c1.txt"), "clip-data");
    const res = await t.app.inject({
      method: "GET",
      url: "/media/clips/c1.txt",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("clip-data");
  });

  it("경로 순회(/media/../)는 차단된다", async () => {
    // workspace 밖 파일 — 유출되면 안 되는 대상
    writeFileSync(path.join(t.workspaceDir, "..", "secret-outside.txt"), "SECRET");
    try {
      for (const url of [
        "/media/../secret-outside.txt",
        "/media/%2e%2e/secret-outside.txt",
        "/media/..%2fsecret-outside.txt",
      ]) {
        const res = await t.app.inject({ method: "GET", url });
        expect([403, 404]).toContain(res.statusCode);
        expect(res.body).not.toContain("SECRET");
      }
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(path.join(t.workspaceDir, "..", "secret-outside.txt"), {
        force: true,
      });
    }
  });
});

// ---------------------------------------------------------------- 파이프라인 미배선(기본 주입)

describe("파이프라인 미배선", () => {
  it("advance가 503을 반환한다 (NotWiredPipeline)", async () => {
    const { buildApp } = await import("../app.js");
    const { createTestDao, seedBasic } = await import("./test-utils.js");
    const dao = createTestDao();
    seedBasic(dao);
    const app = await buildApp({ dao, workspaceDir: t.workspaceDir });
    const res = await app.inject({
      method: "POST",
      url: "/api/episodes/ep1/advance",
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
