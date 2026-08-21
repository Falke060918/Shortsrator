/**
 * 판테온 15초 5컷 파일럿 완주 E2E (REQ-PILOT-01, issue #10).
 *
 * MANUAL 모드로 TOPIC→SCRIPT→GATE1→TTS→SHOTLIST→MASTER_ASSET→FRAME_GEN(드롭)
 * →GATE2→VIDEO_GEN(드롭)→GATE3(채택)→ASSEMBLY→GATE4 까지 HTTP API 로 완주한다.
 * 외부 네트워크 0 — 대본·오디오·프레임·클립 전부 로컬 픽스처(ffmpeg lavfi 합성)다.
 * 검증: workspace/{channel}/{themeVersion}/{episode}/ 계층 + final 1080x1920 +
 * 총길이 = 문장별 오디오 실측 합(±0.1s).
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EpisodeState, Gate, ServerEvent } from "@shortsrator/shared";
import { buildApp } from "../app.js";
import {
  createDao,
  migrate,
  openDb,
  type Dao,
  type Db,
  type JobRow,
} from "../db/index.js";
import { runFfmpeg } from "../media/ffmpeg.js";
import { probeDurationMs, probeVideoStream } from "../media/probe.js";
import {
  createWiredPipeline,
  ensureThemePresets,
  type WiredPipeline,
} from "./index.js";

const THEME_ID = "mysterious-architecture";
const THEME_VERSION_ID = "mysterious-architecture-v1";
const TOPIC_ID = "pantheon";

/** 파일럿 대본 픽스처 — 5문장(= 5컷), 문장 1개 = 샷 1개 */
const SCRIPT_TEXT = [
  "로마 한복판, 2천 년 된 콘크리트 돔이 아직도 서 있다.",
  "철근 하나 없이 버티는 세계 최대의 무근 콘크리트 돔이다.",
  "비밀은 위로 갈수록 가벼워지는 골재 배합에 있다.",
  "돔 꼭대기 지름 9미터의 구멍, 오쿨루스가 무게를 덜어낸다.",
  "하중은 두꺼운 벽을 타고 아래로 흘러 2천 년을 버텼다.",
].join("\n");

/** 문장별 오디오 길이(초) — 프리셋 pilot_template 합계 15초 */
const AUDIO_SECONDS = [3, 2, 3, 3, 4];

/** 오디오-영상 싱크 허용 오차(ms) — REQ-PILOT-01 ±0.1s */
const TOLERANCE_MS = 100;

const FIXTURE_TIMEOUT = 120_000;
const FLOW_TIMEOUT = 300_000;

let fixtureDir: string;
let workspaceDir: string;
let audioBufs: Buffer[];
let pngBuf: Buffer;
let mp4Buf: Buffer;

let db: Db;
let dao: Dao;
let pipeline: WiredPipeline;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), "shortsrator-e2e-fix-"));
  workspaceDir = await mkdtemp(path.join(tmpdir(), "shortsrator-e2e-ws-"));

  // 픽스처 합성 — 전부 로컬 ffmpeg lavfi (외부 네트워크 0)
  audioBufs = [];
  for (const [i, sec] of AUDIO_SECONDS.entries()) {
    const p = path.join(fixtureDir, `audio-${i}.wav`);
    await runFfmpeg([
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(sec), p,
    ]);
    audioBufs.push(await readFile(p));
  }
  const pngPath = path.join(fixtureDir, "frame.png");
  await runFfmpeg([
    "-f", "lavfi", "-i", "color=c=gray:s=540x960", "-frames:v", "1", pngPath,
  ]);
  pngBuf = await readFile(pngPath);
  const mp4Path = path.join(fixtureDir, "clip.mp4");
  await runFfmpeg([
    "-f", "lavfi", "-i", "color=c=teal:s=540x960:r=30", "-t", "5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4Path,
  ]);
  mp4Buf = await readFile(mp4Path);

  // 인메모리 DB + 프리셋 로드 + 주제 시드 → 실배선 파이프라인 (짧은 폴링)
  db = openDb(":memory:");
  migrate(db);
  dao = createDao(db);
  ensureThemePresets(dao); // 저장소 presets/ 원본
  dao.topics.insert({
    id: TOPIC_ID,
    theme_id: THEME_ID,
    title: "판테온",
    status: "QUEUED",
    source: null,
  });
  pipeline = createWiredPipeline({ dao, workspaceDir, pollIntervalMs: 15 });
  app = await buildApp({ dao, pipeline, workspaceDir });
}, FIXTURE_TIMEOUT);

afterAll(async () => {
  await app?.close();
  try {
    db?.close();
  } catch {
    // 이미 닫혔으면 무시
  }
  await rm(fixtureDir, { recursive: true, force: true });
  await rm(workspaceDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 헬퍼

function multipart(files: Array<{ name: string; content: Buffer }>) {
  const boundary = "----shortsratorE2E";
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${f.name}"\r\n` +
          "Content-Type: application/octet-stream\r\n\r\n",
      ),
    );
    parts.push(f.content, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function drop(jobId: string, files: Array<{ name: string; content: Buffer }>) {
  const { payload, contentType } = multipart(files);
  const res = await app.inject({
    method: "POST",
    url: `/api/manual/${jobId}/files`,
    headers: { "content-type": contentType },
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function waitFor<T>(
  fn: () => T | undefined,
  what: string,
  timeoutMs = 20_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`대기 초과: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

const handled = new Set<string>();

/** MANUAL 대기 잡이 정확히 count 개 모일 때까지 대기 (처리한 잡 제외) */
function waitPending(
  episodeId: string,
  match: (job: JobRow) => boolean,
  count: number,
): Promise<JobRow[]> {
  return waitFor(() => {
    const jobs = dao.jobs
      .listByEpisode(episodeId)
      .filter(
        (j) => j.status === "manual_pending" && !handled.has(j.id) && match(j),
      );
    return jobs.length >= count ? jobs : undefined;
  }, `manual_pending ${count}건`);
}

async function advance(episodeId: string, expected: EpisodeState) {
  const res = await app.inject({
    method: "POST",
    url: `/api/episodes/${episodeId}/advance`,
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().state).toBe(expected);
}

async function approveGate(episodeId: string, gate: Gate, expected: EpisodeState) {
  const res = await app.inject({
    method: "POST",
    url: `/api/episodes/${episodeId}/gate`,
    payload: { gate, decision: "approve" },
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().state).toBe(expected);
}

// ---------------------------------------------------------------- 테스트

describe("판테온 파일럿 E2E (MANUAL 모드)", () => {
  it(
    "TOPIC→…→GATE4 완주: workspace 계층 + 1080x1920 + 총길이=오디오 합(±0.1s)",
    async () => {
      // 어댑터 4종 MANUAL 전환 (REQ-ADAPT-01) — 설정 라우트 경유
      const settings = await app.inject({
        method: "PUT",
        url: "/api/settings",
        payload: {
          adapterModes: { llm: "manual", tts: "manual", image: "manual", video: "manual" },
        },
      });
      expect(settings.statusCode).toBe(200);
      expect(settings.json().adapterModes).toEqual({
        llm: "manual",
        tts: "manual",
        image: "manual",
        video: "manual",
      });

      // 에피소드 생성 (TOPIC)
      const created = await app.inject({
        method: "POST",
        url: "/api/episodes",
        payload: { topicId: TOPIC_ID },
      });
      expect(created.statusCode, created.body).toBe(201);
      const episodeId = created.json().id as string;

      const events: ServerEvent[] = [];
      const unsubscribe = pipeline.subscribe(episodeId, (e) => events.push(e));

      // SCRIPT: LLM 수동 대본 드롭
      await advance(episodeId, "SCRIPT");
      const [scriptJob] = await waitPending(episodeId, (j) => j.kind === "script", 1);
      await drop(scriptJob.id, [
        { name: "script.txt", content: Buffer.from(SCRIPT_TEXT, "utf-8") },
      ]);
      handled.add(scriptJob.id);
      await pipeline.waitForIdle(episodeId);

      // GATE1: 대본 승인 → TTS (문장 순서대로 순차 합성 — 잡 1개씩 드롭)
      await advance(episodeId, "SCRIPT_GATE");
      await approveGate(episodeId, "SCRIPT_GATE", "TTS");
      for (let i = 0; i < AUDIO_SECONDS.length; i++) {
        const [job] = await waitPending(episodeId, (j) => j.kind === "tts", 1);
        await drop(job.id, [{ name: `shot-${i}.wav`, content: audioBufs[i] }]);
        handled.add(job.id);
      }
      await pipeline.waitForIdle(episodeId);

      // 샷리스트: 문장 1개 = 샷 1개, 컷 길이 = 오디오 실측(ms)
      const shots = dao.shots.listByEpisode(episodeId);
      expect(shots).toHaveLength(5);
      for (const [i, shot] of shots.entries()) {
        expect(Math.abs(shot.duration_ms - AUDIO_SECONDS[i] * 1000)).toBeLessThanOrEqual(80);
      }
      expect(shots[3].gen_method).toBe("START_END"); // pilot_template idx 3

      await advance(episodeId, "SHOTLIST");
      await pipeline.waitForIdle(episodeId);

      // MASTER_ASSET: 기준 이미지 4장 드롭
      await advance(episodeId, "MASTER_ASSET");
      const masterJobs = await waitPending(episodeId, (j) => j.kind === "master_asset", 4);
      for (const job of masterJobs) {
        await drop(job.id, [{ name: `${job.id.slice(0, 8)}.png`, content: pngBuf }]);
        handled.add(job.id);
      }
      await pipeline.waitForIdle(episodeId);
      expect(dao.masterAssets.listByTopic(TOPIC_ID)).toHaveLength(4);

      // FRAME_GEN: 샷별 프레임 드롭 — START_END 샷은 시작·끝 2장
      await advance(episodeId, "FRAME_GEN");
      const frameJobs = await waitPending(episodeId, (j) => j.kind === "frame_gen", 5);
      for (const job of frameJobs) {
        const shot = dao.shots.get(job.shot_id ?? "");
        const files =
          shot?.gen_method === "START_END"
            ? [
                { name: "start.png", content: pngBuf },
                { name: "end.png", content: pngBuf },
              ]
            : [{ name: "frame.png", content: pngBuf }];
        await drop(job.id, files);
        handled.add(job.id);
      }
      await pipeline.waitForIdle(episodeId);
      expect(
        dao.generatedAssets
          .listByShot(shots[3].id)
          .filter((a) => a.kind === "frame"),
      ).toHaveLength(2);

      // GATE2: 프레임 승인 → VIDEO_GEN (START_END 는 강등 체인 → manual 종단)
      await advance(episodeId, "FRAME_GATE");
      await approveGate(episodeId, "FRAME_GATE", "VIDEO_GEN");
      const videoJobs = await waitPending(episodeId, (j) => j.kind.startsWith("video"), 5);
      for (const job of videoJobs) {
        await drop(job.id, [{ name: "clip.mp4", content: mp4Buf }]);
        handled.add(job.id);
      }
      await pipeline.waitForIdle(episodeId);
      expect(dao.shots.get(shots[3].id)?.transition_type).toBe("manual");
      expect(
        videoJobs.map((j) => j.kind).sort(),
      ).toEqual([
        "video_i2v",
        "video_i2v",
        "video_i2v",
        "video_i2v",
        "video_start_end",
      ]);

      // GATE3: 클립 채택(0.1초 그리드) 후 승인 → ASSEMBLY
      await advance(episodeId, "CLIP_GATE");
      for (const shot of dao.shots.listByEpisode(episodeId)) {
        const clip = dao.generatedAssets
          .listByShot(shot.id)
          .find((a) => a.kind === "clip");
        expect(clip).toBeDefined();
        const inMs = shot.idx === 0 ? 100 : 0; // trim 경로도 1건 검증
        const outMs = inMs + Math.ceil(shot.duration_ms / 100) * 100;
        const res = await app.inject({
          method: "POST",
          url: `/api/shots/${shot.id}/adopt`,
          payload: { assetId: clip!.id, inMs, outMs },
        });
        expect(res.statusCode, res.body).toBe(200);
      }
      await approveGate(episodeId, "CLIP_GATE", "ASSEMBLY");
      await pipeline.waitForIdle(episodeId);

      // 산출 검증: workspace 계층 + final mp4
      const episodeRoot = path.join(workspaceDir, "default", THEME_VERSION_ID, episodeId);
      for (const sub of ["script", "tts", "frames", "clips", "master", "final"]) {
        expect(existsSync(path.join(episodeRoot, sub)), sub).toBe(true);
        expect((await readdir(path.join(episodeRoot, sub))).length).toBeGreaterThan(0);
      }
      const finalPath = path.join(episodeRoot, "final", "final.mp4");
      expect(existsSync(finalPath)).toBe(true);

      const { width, height } = await probeVideoStream(finalPath);
      expect(width).toBe(1080);
      expect(height).toBe(1920);

      const audioSumMs = dao.shots
        .listByEpisode(episodeId)
        .reduce((sum, s) => sum + s.duration_ms, 0);
      const finalMs = await probeDurationMs(finalPath);
      expect(Math.abs(finalMs - audioSumMs)).toBeLessThanOrEqual(TOLERANCE_MS);

      // 지표·비용 반영 확인
      const episode = dao.episodes.get(episodeId);
      const metrics = JSON.parse(episode?.metrics_json ?? "{}") as {
        final_duration_ms?: number;
        cut_durations_ms?: number[];
      };
      expect(metrics.cut_durations_ms).toHaveLength(5);
      expect(episode?.cost_json).toBeTruthy();

      // GATE4: 최종 승인 → UPLOAD (P2 — 자동 작업 없음)
      await advance(episodeId, "FINAL_GATE");
      await approveGate(episodeId, "FINAL_GATE", "UPLOAD");
      const detail = await app.inject({ method: "GET", url: `/api/episodes/${episodeId}` });
      expect(detail.json().state).toBe("UPLOAD");

      // SSE 원천(구독) 이벤트에 상태 전이가 흘렀다
      unsubscribe();
      const states = events
        .filter((e) => e.type === "episode_state")
        .map((e) => (e as { state: EpisodeState }).state);
      expect(states).toContain("VIDEO_GEN");
      expect(states).toContain("UPLOAD");
    },
    FLOW_TIMEOUT,
  );

  it("부팅 배선: buildApp 기본 경로가 프리셋을 DB에 로드하고 실파이프라인을 조립한다", async () => {
    const bootWs = await mkdtemp(path.join(tmpdir(), "shortsrator-e2e-boot-"));
    const bootApp = await buildApp({ workspaceDir: bootWs });
    try {
      const state = await bootApp.inject({ method: "GET", url: "/api/state" });
      expect(state.statusCode).toBe(200);

      const bootDb = openDb(path.join(bootWs, "shortsrator.db"));
      try {
        const bootDao = createDao(bootDb);
        expect(bootDao.themes.get(THEME_ID)?.current_version_id).toBe(THEME_VERSION_ID);
        const version = bootDao.themeVersions.get(THEME_VERSION_ID);
        expect(version?.version_no).toBe(1);
      } finally {
        bootDb.close();
      }
    } finally {
      await bootApp.close();
      await rm(bootWs, { recursive: true, force: true });
    }
  });
});
