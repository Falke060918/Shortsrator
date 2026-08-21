/** routes 통합테스트 공용 헬퍼 — 인메모리 DB + 목 파이프라인 + 임시 workspace. */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AdoptRequest,
  AdvanceResponse,
  EpisodeState,
  GateRequest,
  ServerEvent,
} from "@shortsrator/shared";
import { buildApp } from "../app.js";
import { createDao, migrate, openDb, type Dao } from "../db/index.js";
import type { PipelineService } from "./pipeline-service.js";

export function createTestDao(): Dao {
  const db = openDb(":memory:");
  migrate(db);
  return createDao(db);
}

/** 호출 기록 + 이벤트 발행이 가능한 목 파이프라인 */
export class MockPipeline implements PipelineService {
  calls: Array<{ method: string; args: unknown[] }> = [];
  private listeners = new Map<string, Set<(event: ServerEvent) => void>>();

  async advance(episodeId: string): Promise<AdvanceResponse> {
    this.calls.push({ method: "advance", args: [episodeId] });
    return { state: "SCRIPT", jobId: "job-adv-1" };
  }

  async decideGate(
    episodeId: string,
    request: GateRequest,
  ): Promise<{ state: EpisodeState }> {
    this.calls.push({ method: "decideGate", args: [episodeId, request] });
    return { state: "TTS" };
  }

  async adoptClip(shotId: string, request: AdoptRequest): Promise<void> {
    this.calls.push({ method: "adoptClip", args: [shotId, request] });
  }

  async rollback(
    episodeId: string,
    toState: EpisodeState,
  ): Promise<{ state: EpisodeState }> {
    this.calls.push({ method: "rollback", args: [episodeId, toState] });
    return { state: toState };
  }

  async onManualFiles(jobId: string, filePaths: string[]): Promise<void> {
    this.calls.push({ method: "onManualFiles", args: [jobId, filePaths] });
  }

  subscribe(
    episodeId: string,
    listener: (event: ServerEvent) => void,
  ): () => void {
    let set = this.listeners.get(episodeId);
    if (!set) {
      set = new Set();
      this.listeners.set(episodeId, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  emit(episodeId: string, event: ServerEvent): void {
    for (const listener of this.listeners.get(episodeId) ?? []) {
      listener(event);
    }
  }
}

/** 표준 시드: 테마(tv1 확정) + 주제 tp1 + 에피소드 ep1(SCRIPT_GATE) + 샷 sh1 + 잡 job1 */
export function seedBasic(dao: Dao): void {
  dao.themes.insert({
    id: "th1",
    name: "신비한 건축 사전",
    status: "TESTING",
    channel_id: null,
    current_version_id: "tv1",
  });
  dao.themeVersions.insert({
    id: "tv1",
    theme_id: "th1",
    version_no: 1,
    rules_json: "{}",
    changelog: "",
  });
  dao.topics.insert({
    id: "tp1",
    theme_id: "th1",
    title: "판테온",
    status: "QUEUED",
    source: null,
  });
  dao.episodes.insert({
    id: "ep1",
    theme_version_id: "tv1",
    topic_id: "tp1",
    state: "SCRIPT_GATE",
    metrics_json: null,
    cost_json: JSON.stringify({ credits: 12, krw: 3400 }),
  });
  dao.shots.insert({
    id: "sh1",
    episode_id: "ep1",
    idx: 0,
    narration: "돔 지붕의 비밀",
    duration_ms: 3200,
    gen_method: "I2V",
    camera_moves_json: JSON.stringify(["dolly_in"]),
    image_prompt: "pantheon dome",
    motion_prompt: "slow dolly in",
    transition_type: null,
    fallback_json: "[]",
    adopted_asset_id: null,
    adopted_in_ms: null,
    adopted_out_ms: null,
  });
  dao.gateDecisions.insert({
    id: "gd1",
    episode_id: "ep1",
    gate: "SCRIPT_GATE",
    decision: "reject",
    payload_json: JSON.stringify({ note: "2문장 압축" }),
  });
  dao.jobs.insert({
    id: "job1",
    episode_id: "ep1",
    shot_id: "sh1",
    kind: "image_gen",
    adapter: "manual",
    status: "manual_pending",
    request_id: null,
    cost_credits: null,
    cost_krw: null,
    payload_json: null,
    error: null,
  });
}

export interface TestApp {
  app: Awaited<ReturnType<typeof buildApp>>;
  dao: Dao;
  pipeline: MockPipeline;
  workspaceDir: string;
  cleanup(): Promise<void>;
}

export async function buildTestApp(): Promise<TestApp> {
  const dao = createTestDao();
  seedBasic(dao);
  const pipeline = new MockPipeline();
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "shortsrator-test-"));
  const app = await buildApp({ dao, pipeline, workspaceDir });
  return {
    app,
    dao,
    pipeline,
    workspaceDir,
    async cleanup() {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}
