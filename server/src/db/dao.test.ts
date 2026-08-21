import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDao, type Dao } from "./dao.js";
import { openDb, type Db } from "./db.js";
import { migrate } from "./migrate.js";

let db: Db;
let dao: Dao;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "shortsrator-dao-"));
  db = openDb(path.join(dir, "test.db"));
  migrate(db);
  dao = createDao(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 테마→버전→주제→에피소드까지의 공통 픽스처 */
function seedEpisode() {
  const themeId = randomUUID();
  dao.themes.insert({
    id: themeId,
    name: "신비한 건축 사전",
    status: "DRAFT",
    channel_id: null,
    current_version_id: null,
  });
  const versionId = randomUUID();
  dao.themeVersions.insert({
    id: versionId,
    theme_id: themeId,
    version_no: 1,
    rules_json: JSON.stringify({ style_string: "cinematic" }),
    changelog: "최초 버전",
  });
  dao.themes.setCurrentVersion(themeId, versionId);
  const topicId = randomUUID();
  dao.topics.insert({
    id: topicId,
    theme_id: themeId,
    title: "판테온",
    status: "QUEUED",
    source: "manual",
  });
  const episodeId = randomUUID();
  dao.episodes.insert({
    id: episodeId,
    theme_version_id: versionId,
    topic_id: topicId,
    state: "TOPIC",
    metrics_json: null,
    cost_json: null,
  });
  return { themeId, versionId, topicId, episodeId };
}

describe("themes / theme_versions / topics", () => {
  it("테마 라운드트립 + 상태 전이 + current_version 지정", () => {
    const { themeId, versionId } = seedEpisode();
    const theme = dao.themes.get(themeId);
    expect(theme?.name).toBe("신비한 건축 사전");
    expect(theme?.current_version_id).toBe(versionId);

    dao.themes.updateStatus(themeId, "TESTING");
    expect(dao.themes.get(themeId)?.status).toBe("TESTING");
    expect(dao.themes.list().length).toBe(1);

    const versions = dao.themeVersions.listByTheme(themeId);
    expect(versions.map((v) => v.version_no)).toEqual([1]);
    expect(JSON.parse(versions[0].rules_json).style_string).toBe("cinematic");
  });

  it("같은 테마의 version_no는 유일하다", () => {
    const { themeId } = seedEpisode();
    expect(() =>
      dao.themeVersions.insert({
        id: randomUUID(),
        theme_id: themeId,
        version_no: 1,
        rules_json: "{}",
        changelog: "",
      }),
    ).toThrow();
  });

  it("주제 큐: 테마별 조회와 상태 갱신", () => {
    const { themeId, topicId } = seedEpisode();
    expect(dao.topics.listByTheme(themeId).length).toBe(1);
    dao.topics.updateStatus(topicId, "USED");
    expect(dao.topics.get(topicId)?.status).toBe("USED");
  });
});

describe("episodes", () => {
  it("상태 전이가 updated_at을 갱신하고 상태별 조회가 된다", () => {
    const { episodeId } = seedEpisode();
    dao.episodes.updateState(episodeId, "SCRIPT");
    const ep = dao.episodes.get(episodeId);
    expect(ep?.state).toBe("SCRIPT");
    expect(dao.episodes.listByState("SCRIPT").map((e) => e.id)).toEqual([
      episodeId,
    ]);
    expect(dao.episodes.listByState("TOPIC")).toEqual([]);
  });

  it("메트릭·비용 JSON을 기록한다", () => {
    const { episodeId } = seedEpisode();
    dao.episodes.updateMetrics(episodeId, JSON.stringify({ frameApproval: 0.5 }));
    dao.episodes.updateCost(episodeId, JSON.stringify({ krw: 12000 }));
    const ep = dao.episodes.get(episodeId);
    expect(JSON.parse(ep!.metrics_json!).frameApproval).toBe(0.5);
    expect(JSON.parse(ep!.cost_json!).krw).toBe(12000);
  });
});

describe("shots / generated_assets / master_assets", () => {
  it("샷 일괄 삽입은 idx 순으로 조회되고 길이는 ms 정수다", () => {
    const { episodeId } = seedEpisode();
    const mk = (idx: number, duration_ms: number) => ({
      id: randomUUID(),
      episode_id: episodeId,
      idx,
      narration: `문장 ${idx}`,
      duration_ms,
      gen_method: "I2V" as const,
      camera_moves_json: JSON.stringify(["push_in"]),
      image_prompt: "판테온 외경",
      motion_prompt: "slow push in",
      transition_type: null,
      fallback_json: "[]",
      adopted_asset_id: null,
      adopted_in_ms: null,
      adopted_out_ms: null,
    });
    dao.shots.insertMany([mk(1, 2500), mk(0, 3100)]);
    const shots = dao.shots.listByEpisode(episodeId);
    expect(shots.map((s) => s.idx)).toEqual([0, 1]);
    expect(shots.map((s) => s.duration_ms)).toEqual([3100, 2500]);
  });

  it("같은 에피소드에서 idx는 유일하고, insertMany는 전체 롤백된다", () => {
    const { episodeId } = seedEpisode();
    const mk = (id: string, idx: number) => ({
      id,
      episode_id: episodeId,
      idx,
      narration: "n",
      duration_ms: 1000,
      gen_method: "T2V" as const,
      camera_moves_json: "[]",
      image_prompt: "p",
      motion_prompt: "m",
      transition_type: null,
      fallback_json: "[]",
      adopted_asset_id: null,
      adopted_in_ms: null,
      adopted_out_ms: null,
    });
    expect(() =>
      dao.shots.insertMany([mk(randomUUID(), 0), mk(randomUUID(), 0)]),
    ).toThrow();
    expect(dao.shots.listByEpisode(episodeId)).toEqual([]);
  });

  it("없는 에피소드를 가리키는 샷은 FK 위반으로 거부된다", () => {
    seedEpisode();
    expect(() =>
      dao.shots.insert({
        id: randomUUID(),
        episode_id: "없는-에피소드",
        idx: 0,
        narration: "n",
        duration_ms: 1000,
        gen_method: "I2V",
        camera_moves_json: "[]",
        image_prompt: "p",
        motion_prompt: "m",
        transition_type: null,
        fallback_json: "[]",
        adopted_asset_id: null,
        adopted_in_ms: null,
        adopted_out_ms: null,
      }),
    ).toThrow();
  });

  it("후보 애셋: meta_json 저장, 승인/반려, GATE3 채택(0.1초=100ms 단위)", () => {
    const { episodeId } = seedEpisode();
    const shotId = randomUUID();
    dao.shots.insert({
      id: shotId,
      episode_id: episodeId,
      idx: 0,
      narration: "n",
      duration_ms: 3000,
      gen_method: "START_END",
      camera_moves_json: "[]",
      image_prompt: "p",
      motion_prompt: "m",
      transition_type: "frames",
      fallback_json: JSON.stringify(["edit_splice", "manual"]),
      adopted_asset_id: null,
      adopted_in_ms: null,
      adopted_out_ms: null,
    });
    const assetId = randomUUID();
    dao.generatedAssets.insert({
      id: assetId,
      shot_id: shotId,
      kind: "clip",
      file_path: "clips/0_r1.mp4",
      gen_round: 1,
      approved: null,
      reject_reason: null,
      meta_json: JSON.stringify({ model: "dop", seed: 42, motion_id: "push_in" }),
    });
    // 반려 → 재판정 승인
    dao.generatedAssets.setApproval(assetId, false, "손 왜곡");
    let asset = dao.generatedAssets.get(assetId);
    expect(asset?.approved).toBe(0);
    expect(asset?.reject_reason).toBe("손 왜곡");
    dao.generatedAssets.setApproval(assetId, true);
    asset = dao.generatedAssets.get(assetId);
    expect(asset?.approved).toBe(1);
    expect(asset?.reject_reason).toBeNull();
    expect(JSON.parse(asset!.meta_json!).seed).toBe(42);
    expect(dao.generatedAssets.listByShot(shotId).length).toBe(1);

    // GATE3 채택: 0.1초 단위 = 100ms 배수 입력
    dao.shots.adopt(shotId, assetId, 200, 3200);
    const shot = dao.shots.get(shotId);
    expect(shot?.adopted_asset_id).toBe(assetId);
    expect(shot?.adopted_in_ms).toBe(200);
    expect(shot?.adopted_out_ms).toBe(3200);
  });

  it("전환 강등 체인: transition_type 갱신", () => {
    const { episodeId } = seedEpisode();
    const shotId = randomUUID();
    dao.shots.insert({
      id: shotId,
      episode_id: episodeId,
      idx: 0,
      narration: "n",
      duration_ms: 1500,
      gen_method: "START_END",
      camera_moves_json: "[]",
      image_prompt: "p",
      motion_prompt: "m",
      transition_type: "frames",
      fallback_json: JSON.stringify(["edit_splice", "manual"]),
      adopted_asset_id: null,
      adopted_in_ms: null,
      adopted_out_ms: null,
    });
    dao.shots.updateTransition(shotId, "edit_splice");
    expect(dao.shots.get(shotId)?.transition_type).toBe("edit_splice");
  });

  it("마스터 애셋: 주제별 조회", () => {
    const { topicId } = seedEpisode();
    dao.masterAssets.insert({
      id: randomUUID(),
      topic_id: topicId,
      role: "exterior",
      file_path: "master/exterior.png",
    });
    const list = dao.masterAssets.listByTopic(topicId);
    expect(list.map((m) => m.role)).toEqual(["exterior"]);
  });
});

describe("gate_decisions", () => {
  it("게이트 판정 기록과 에피소드별 이력 조회", () => {
    const { episodeId } = seedEpisode();
    dao.gateDecisions.insert({
      id: randomUUID(),
      episode_id: episodeId,
      gate: "SCRIPT_GATE",
      decision: "reject",
      payload_json: JSON.stringify({ reason: "훅 약함" }),
    });
    dao.gateDecisions.insert({
      id: randomUUID(),
      episode_id: episodeId,
      gate: "SCRIPT_GATE",
      decision: "approve",
      payload_json: null,
    });
    const history = dao.gateDecisions.listByEpisode(episodeId);
    expect(history.length).toBe(2);
    expect(history.map((h) => h.decision)).toEqual(["reject", "approve"]);
  });
});

describe("jobs (03 수정 2 — 비용 추적·크래시 재개·MANUAL 대기)", () => {
  it("잡 라이프사이클: queued → running → succeeded + 비용 기록", () => {
    const { episodeId } = seedEpisode();
    const jobId = randomUUID();
    dao.jobs.insert({
      id: jobId,
      episode_id: episodeId,
      shot_id: null,
      kind: "tts",
      adapter: "elevenlabs",
      status: "queued",
      request_id: null,
      cost_credits: null,
      cost_krw: null,
      payload_json: JSON.stringify({ text: "판테온은..." }),
      error: null,
    });
    dao.jobs.updateStatus(jobId, "running");
    dao.jobs.setRequestId(jobId, "req-123");
    dao.jobs.setCost(jobId, 1.5, 30);
    dao.jobs.updateStatus(jobId, "succeeded");
    const job = dao.jobs.get(jobId);
    expect(job?.status).toBe("succeeded");
    expect(job?.request_id).toBe("req-123");
    expect(job?.cost_credits).toBe(1.5);
    expect(job?.cost_krw).toBe(30);
    expect(job?.error).toBeNull();
  });

  it("실패 잡은 error를 남기고, 상태별 조회로 재개 대상을 찾는다", () => {
    const { episodeId } = seedEpisode();
    const failedId = randomUUID();
    const pendingId = randomUUID();
    const base = {
      episode_id: episodeId,
      shot_id: null,
      kind: "video_i2v",
      adapter: "higgsfield",
      request_id: null,
      cost_credits: null,
      cost_krw: null,
      payload_json: null,
      error: null,
    };
    dao.jobs.insert({ ...base, id: failedId, status: "running" });
    dao.jobs.insert({
      ...base,
      id: pendingId,
      adapter: "manual",
      status: "manual_pending",
    });
    dao.jobs.updateStatus(failedId, "failed", "HTTP 429");
    expect(dao.jobs.get(failedId)?.error).toBe("HTTP 429");
    expect(dao.jobs.listByStatus("manual_pending").map((j) => j.id)).toEqual([
      pendingId,
    ]);
    expect(dao.jobs.listByEpisode(episodeId).length).toBe(2);
  });
});

describe("settings KV (03 수정 4)", () => {
  it("get/set 업서트와 전체 조회", () => {
    expect(dao.settings.get("tts_vendor")).toBeUndefined();
    dao.settings.set("tts_vendor", "elevenlabs");
    dao.settings.set("budget_krw_per_episode", "5000");
    expect(dao.settings.get("tts_vendor")).toBe("elevenlabs");
    dao.settings.set("tts_vendor", "typecast"); // 업서트
    expect(dao.settings.get("tts_vendor")).toBe("typecast");
    expect(dao.settings.all()).toEqual({
      tts_vendor: "typecast",
      budget_krw_per_episode: "5000",
    });
  });
});
