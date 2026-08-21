/**
 * 실배선 PipelineService (issue #10 pilot-integration) — routes 의 NotWired 자리에
 * 주입되는 실제 구현. 에피소드 상태 전이는 전부 pipeline 배럴의 PipelineEngine 을
 * 경유한다(게이트 불가침은 엔진 표면 기준) — 여기서 dao.episodes.updateState 를
 * 직접 부르지 않는다.
 *
 * 동작 모델:
 * - advance/decideGate 로 단계 상태에 **들어가면** 그 단계의 자동 작업(runStage)이
 *   백그라운드로 돈다. 작업이 끝나기 전의 재전이 요청은 StageBusyError(409)다 —
 *   MANUAL 드롭 대기 중 단계를 건너뛰는 일이 구조적으로 불가능하다.
 * - MANUAL 잡은 jobs 테이블에 manual_pending 으로 남고, onManualFiles 가
 *   소유 어댑터에 드롭을 전달하면 잡 러너 폴링이 이어서 완주한다.
 * - 산출물은 workspace/{channel}/{themeVersion}/{episode}/{script|tts|frames|clips|master|final}/
 *   계층에 둔다 (03-architecture 되돌리기 어려운 결정 1). DB에는 메타만.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdoptRequest,
  AdvanceResponse,
  EpisodeState,
  GateRequest,
  ServerEvent,
} from "@shortsrator/shared";
import type {
  Dao,
  EpisodeRow,
  GeneratedAssetRow,
  JobRow,
  ShotRow,
  ThemeVersionRow,
  TopicRow,
} from "../db/index.js";
import {
  GateStateMismatchError,
  JobRunner,
  PipelineEngine,
  buildShotlist,
  isGateState,
  persistEpisodeCost,
  runStartEndShot,
  type SentencePlan,
} from "../pipeline/index.js";
import {
  buildImagePrompt,
  buildMasterAssetPrompts,
  buildMotionPrompt,
  suggestCameraMoves,
  validateThemePreset,
  type ThemePreset,
} from "../theme/index.js";
import { StartEndChain } from "../adapters/video/start-end-chain.js";
import { assembleEpisode, assertTrimGrid } from "../media/assemble.js";
import type { PipelineService } from "../routes/pipeline-service.js";
import { AdapterSet } from "./adapter-set.js";

/** 자동 작업이 있는 단계 — 게이트·TOPIC·UPLOAD(P2)·PUBLISHED 는 제외 */
const STAGE_STATES: ReadonlySet<EpisodeState> = new Set([
  "SCRIPT",
  "TTS",
  "SHOTLIST",
  "MASTER_ASSET",
  "FRAME_GEN",
  "VIDEO_GEN",
  "ASSEMBLY",
]);

/** SCRIPT 단계 산출 파일명 (script/ 하위) */
const SCRIPT_FILE = "script.md";

/** 단계 작업 진행 중 재전이 시도 — routes 에서 409 로 매핑된다 */
export class StageBusyError extends Error {
  constructor(episodeId: string, state: EpisodeState) {
    super(`이전 단계 작업이 아직 진행 중이다 (${episodeId}: ${state})`);
    this.name = "StageBusyError";
  }
}

export interface WiredPipelineOptions {
  dao: Dao;
  /** workspace 루트(절대 경로) */
  workspaceDir: string;
  /** 잡 러너 폴링 주기(ms) — 기본 2000, 테스트는 짧게 주입 */
  pollIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface WiredPipeline extends PipelineService {
  /** 진행 중 단계 작업의 완료 대기 — 실패는 reject 로 전파된다 (테스트·종료 훅용) */
  waitForIdle(episodeId: string): Promise<void>;
}

interface EpisodeDirs {
  root: string;
  script: string;
  tts: string;
  frames: string;
  clips: string;
  master: string;
  final: string;
}

interface EpisodeContext {
  episode: EpisodeRow;
  topic: TopicRow;
  version: ThemeVersionRow;
  preset: ThemePreset;
  dirs: EpisodeDirs;
}

/** 줄 단위 문장 파싱 — 번호·머리기호를 벗기고 빈 줄을 버린다 */
export function parseScriptSentences(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s+)/, "").trim())
    .filter((line) => line.length > 0);
}

/** 문장 1개 → 샷 계획 — 프리셋 pilot_template(idx 매칭)이 원천, 없으면 동기화 규칙/기본값 */
function planSentence(
  preset: ThemePreset,
  topicTitle: string,
  narration: string,
  idx: number,
): SentencePlan {
  const template = preset.pilot_template.find((t) => t.idx === idx);
  let moveIds = template?.camera_move_ids ?? [];
  if (moveIds.length === 0) {
    moveIds = suggestCameraMoves(preset, narration).slice(
      0,
      preset.camera_rules.max_moves_per_clip,
    );
  }
  if (moveIds.length === 0) moveIds = [preset.camera_grammar[0].id];
  const reveal = template?.reveal === true;
  const shotType = template?.shot_type ?? "establishing shot";
  return {
    narration,
    gen_method: template?.gen_method ?? "I2V",
    camera_moves: moveIds,
    image_prompt: buildImagePrompt(preset, `${topicTitle} — ${shotType}`),
    motion_prompt: buildMotionPrompt(preset, moveIds, { reveal }),
  };
}

function maxRound(assets: GeneratedAssetRow[], kind: string): number {
  return assets
    .filter((a) => a.kind === kind)
    .reduce((max, a) => Math.max(max, a.gen_round), 0);
}

class WiredPipelineService implements WiredPipeline {
  private readonly dao: Dao;
  private readonly workspaceDir: string;
  private readonly engine: PipelineEngine;
  private readonly runner: JobRunner;
  private readonly adapters: AdapterSet;
  private readonly listeners = new Map<string, Set<(event: ServerEvent) => void>>();
  /** 에피소드별 진행 중 단계 작업 — 겹침 방지(assertIdle)의 원천 */
  private readonly active = new Map<
    string,
    { state: EpisodeState; work: Promise<void> }
  >();

  constructor(options: WiredPipelineOptions) {
    this.dao = options.dao;
    this.workspaceDir = options.workspaceDir;
    this.engine = new PipelineEngine(options.dao);
    this.runner = new JobRunner(options.dao, {
      pollIntervalMs: options.pollIntervalMs,
    });
    this.adapters = new AdapterSet(options.dao, options.env ?? process.env);
    this.resumePendingJobs();
  }

  // -------------------------------------------------------------- PipelineService

  async advance(episodeId: string): Promise<AdvanceResponse> {
    this.assertIdle(episodeId);
    const state = this.engine.advance(episodeId);
    this.afterTransition(episodeId, state);
    return { state };
  }

  async decideGate(
    episodeId: string,
    request: GateRequest,
  ): Promise<{ state: EpisodeState }> {
    this.assertIdle(episodeId);
    const state = this.engine.decideGate(episodeId, {
      gate: request.gate,
      decision: request.decision,
      payload: request.payload,
    });
    // 승인 → 다음 단계 작업, 반려 → 재실행 단계 작업(gen_round 증가)
    this.afterTransition(episodeId, state);
    return { state };
  }

  async adoptClip(shotId: string, request: AdoptRequest): Promise<void> {
    const shot = this.dao.shots.get(shotId);
    if (!shot) throw new Error(`샷 없음: ${shotId}`);
    const episode = this.engine.getEpisode(shot.episode_id);
    // 채택은 GATE3 의 행위다 — 다른 상태에서의 채택은 게이트 불일치로 거부
    if (episode.state !== "CLIP_GATE") {
      throw new GateStateMismatchError("CLIP_GATE", episode.state);
    }
    const asset = this.dao.generatedAssets.get(request.assetId);
    if (!asset || asset.shot_id !== shotId || asset.kind !== "clip") {
      throw new Error(`샷 ${shotId} 의 클립 후보가 아니다: ${request.assetId}`);
    }
    assertTrimGrid(request.inMs, "inMs");
    assertTrimGrid(request.outMs, "outMs");
    this.dao.shots.adopt(shotId, request.assetId, request.inMs, request.outMs);
    this.dao.generatedAssets.setApproval(request.assetId, true);
  }

  async rollback(
    episodeId: string,
    toState: EpisodeState,
  ): Promise<{ state: EpisodeState }> {
    this.assertIdle(episodeId);
    const state = this.engine.rollback(episodeId, toState);
    // 롤백은 전이만 한다 — 재실행은 게이트 반려/advance 경로의 몫
    this.emit(episodeId, { type: "episode_state", episodeId, state });
    return { state };
  }

  async onManualFiles(jobId: string, filePaths: string[]): Promise<void> {
    const job = this.dao.jobs.get(jobId);
    if (!job) throw new Error(`잡 없음: ${jobId}`);
    const target = job.adapter === "manual"
      ? this.adapters.manualByKind(job.kind)
      : undefined;
    if (!target) {
      throw new Error(`MANUAL 드롭 대상이 아닌 잡: ${jobId} (${job.adapter}/${job.kind})`);
    }
    // request_id 가 어댑터 측 핸들 키다 (job-runner.persistHandle)
    await target.attachFiles({ jobId: job.request_id ?? job.id }, filePaths);
    this.emit(job.episode_id, {
      type: "job_progress",
      jobId,
      status: "succeeded",
    });
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

  waitForIdle(episodeId: string): Promise<void> {
    return this.active.get(episodeId)?.work ?? Promise.resolve();
  }

  // -------------------------------------------------------------- 전이·스케줄링

  private assertIdle(episodeId: string): void {
    const running = this.active.get(episodeId);
    if (running) throw new StageBusyError(episodeId, running.state);
  }

  private emit(episodeId: string, event: ServerEvent): void {
    for (const listener of this.listeners.get(episodeId) ?? []) {
      listener(event);
    }
  }

  private afterTransition(episodeId: string, state: EpisodeState): void {
    this.emit(episodeId, { type: "episode_state", episodeId, state });
    if (!isGateState(state) && STAGE_STATES.has(state)) {
      this.schedule(episodeId, state);
    }
  }

  private schedule(episodeId: string, state: EpisodeState): void {
    const work = this.runStage(state, episodeId).finally(() => {
      this.active.delete(episodeId);
    });
    this.active.set(episodeId, { state, work });
    // 실패는 jobs 테이블(failed)과 waitForIdle 로 관찰한다 — 미처리 거부 방지
    work.catch(() => {});
  }

  /** 부팅 시 크래시 재개 — MANUAL·인메모리(LocalJobStore) 계열은 복원 불가라 failed 정리된다 */
  private resumePendingJobs(): void {
    try {
      const { resumed } = this.runner.resume((job) => this.resolveResumeAdapter(job));
      for (const { completion } of resumed) completion.catch(() => {});
    } catch {
      // 재개 실패가 부팅을 막지 않는다
    }
  }

  private resolveResumeAdapter(job: JobRow) {
    if (job.adapter !== "higgsfield") return undefined;
    try {
      const dirs = this.dirsOf(job.episode_id);
      if (job.kind.startsWith("video")) return this.adapters.video(dirs.clips).adapter;
      if (job.kind === "master_asset") return this.adapters.image(dirs.master).adapter;
      return this.adapters.image(dirs.frames).adapter;
    } catch {
      return undefined; // 키/에피소드 부재 — failed 정리
    }
  }

  // -------------------------------------------------------------- 컨텍스트·경로

  private dirsOf(episodeId: string): EpisodeDirs {
    const episode = this.engine.getEpisode(episodeId);
    const version = this.dao.themeVersions.get(episode.theme_version_id);
    if (!version) throw new Error(`테마 버전 없음: ${episode.theme_version_id}`);
    const theme = this.dao.themes.get(version.theme_id);
    const channel = theme?.channel_id ?? "default";
    const root = path.join(this.workspaceDir, channel, version.id, episode.id);
    return {
      root,
      script: path.join(root, "script"),
      tts: path.join(root, "tts"),
      frames: path.join(root, "frames"),
      clips: path.join(root, "clips"),
      master: path.join(root, "master"),
      final: path.join(root, "final"),
    };
  }

  private context(episodeId: string): EpisodeContext {
    const episode = this.engine.getEpisode(episodeId);
    const topic = this.dao.topics.get(episode.topic_id);
    if (!topic) throw new Error(`주제 없음: ${episode.topic_id}`);
    const version = this.dao.themeVersions.get(episode.theme_version_id);
    if (!version) throw new Error(`테마 버전 없음: ${episode.theme_version_id}`);

    let data: unknown;
    try {
      data = JSON.parse(version.rules_json);
    } catch {
      throw new Error(`테마 버전 ${version.id}: rules_json 파싱 실패`);
    }
    const errors = validateThemePreset(data);
    if (errors.length > 0) {
      throw new Error(
        `테마 버전 ${version.id}: rules_json 이 프리셋 스키마가 아니다\n- ${errors.join("\n- ")}`,
      );
    }
    return {
      episode,
      topic,
      version,
      preset: data as ThemePreset,
      dirs: this.dirsOf(episodeId),
    };
  }

  private async copyInto(src: string, destDir: string, baseName: string): Promise<string> {
    const ext = path.extname(src) || "";
    const dest = path.join(destDir, `${baseName}${ext}`);
    await mkdir(destDir, { recursive: true });
    if (path.resolve(src) !== path.resolve(dest)) {
      await copyFile(src, dest);
    }
    return dest;
  }

  // -------------------------------------------------------------- 단계 실행

  private async runStage(state: EpisodeState, episodeId: string): Promise<void> {
    switch (state) {
      case "SCRIPT":
        return this.stageScript(episodeId);
      case "TTS":
        return this.stageTts(episodeId);
      case "SHOTLIST":
        return this.stageShotlist(episodeId);
      case "MASTER_ASSET":
        return this.stageMasterAssets(episodeId);
      case "FRAME_GEN":
        return this.stageFrames(episodeId);
      case "VIDEO_GEN":
        return this.stageVideos(episodeId);
      case "ASSEMBLY":
        return this.stageAssembly(episodeId);
      default:
        return;
    }
  }

  /** SCRIPT: LLM 대본 생성 → script/script.md */
  private async stageScript(episodeId: string): Promise<void> {
    const { topic, preset, dirs } = this.context(episodeId);
    const prompt = [
      `유튜브 숏츠 테마 "${preset.title}"의 내레이션 대본을 작성하라.`,
      `주제: ${topic.title}`,
      `문장 수: 정확히 ${preset.format.pilot_shot_count}문장 — 한 줄에 한 문장.`,
      `총 낭독 길이 약 ${Math.round(preset.format.pilot_total_ms / 1000)}초.`,
      "번호·머리기호 없이 문장만 출력하라.",
    ].join("\n");

    const { adapter, name } = this.adapters.llm();
    const done = await this.runner.run(
      { episodeId, kind: "script", adapter: name, payload: { prompt } },
      adapter,
      () => adapter.generate({ prompt }),
    );
    const text = done.output.text.trim();
    if (text.length === 0) throw new Error("대본이 비어 있다");
    await mkdir(dirs.script, { recursive: true });
    await writeFile(path.join(dirs.script, SCRIPT_FILE), text, "utf-8");
  }

  /**
   * TTS: 대본 문장별 합성(실측 ms) → 샷리스트 일괄 생성(buildShotlist) →
   * 오디오를 tts/ 계층으로 복사 + generated_assets(tts_audio) 기록.
   * 샷리스트는 실측과 함께 생성되므로 SHOTLIST 단계는 검증만 한다.
   */
  private async stageTts(episodeId: string): Promise<void> {
    const { topic, preset, dirs } = this.context(episodeId);
    if (this.dao.shots.listByEpisode(episodeId).length > 0) return; // 멱등 재진입

    let text: string;
    try {
      text = await readFile(path.join(dirs.script, SCRIPT_FILE), "utf-8");
    } catch {
      throw new Error("SCRIPT 산출물이 없다 — script/script.md 부재");
    }
    const sentences = parseScriptSentences(text);
    if (sentences.length === 0) throw new Error("대본에서 문장을 찾지 못했다");

    const plans = sentences.map((s, idx) =>
      planSentence(preset, topic.title, s, idx),
    );
    await mkdir(dirs.tts, { recursive: true });
    const { adapter, name } = this.adapters.tts(dirs.tts);
    const built = await buildShotlist(
      { dao: this.dao, runner: this.runner, tts: adapter, ttsAdapterName: name },
      { episodeId, voice: preset.voice_config.profile, sentences: plans },
    );

    for (const [idx, shot] of built.shots.entries()) {
      const out = built.tts[idx];
      const dest = await this.copyInto(out.audioFilePath, dirs.tts, `shot-${shot.idx}`);
      this.dao.generatedAssets.insert({
        id: randomUUID(),
        shot_id: shot.id,
        kind: "tts_audio",
        file_path: dest,
        gen_round: 1,
        approved: 1,
        reject_reason: null,
        meta_json: JSON.stringify({ duration_ms: out.duration_ms }),
      });
    }
  }

  /** SHOTLIST: TTS 단계에서 실측과 함께 생성된 샷리스트의 존재 검증 */
  private async stageShotlist(episodeId: string): Promise<void> {
    if (this.dao.shots.listByEpisode(episodeId).length === 0) {
      throw new Error("샷리스트가 없다 — TTS 단계가 완주되지 않았다");
    }
  }

  /** MASTER_ASSET: 주제당 기준 이미지 4장(§4) — 이미 있으면 재사용(멱등) */
  private async stageMasterAssets(episodeId: string): Promise<void> {
    const { topic, preset, dirs } = this.context(episodeId);
    if (this.dao.masterAssets.listByTopic(topic.id).length > 0) return;

    await mkdir(dirs.master, { recursive: true });
    const { adapter, name } = this.adapters.image(dirs.master);
    await Promise.all(
      buildMasterAssetPrompts(preset, topic.title).map(async ({ role, prompt }) => {
        const done = await this.runner.run(
          { episodeId, kind: "master_asset", adapter: name, payload: { role, prompt } },
          adapter,
          () =>
            adapter.generate({
              prompt,
              referenceImagePaths: [],
              aspect: preset.format.aspect,
              count: 1,
            }),
        );
        const src = done.output.imageFilePaths[0];
        if (!src) throw new Error(`마스터 애셋 산출 없음: ${role}`);
        const dest = await this.copyInto(src, dirs.master, role.toLowerCase());
        this.dao.masterAssets.insert({
          id: randomUUID(),
          topic_id: topic.id,
          role,
          file_path: dest,
        });
      }),
    );
  }

  /** FRAME_GEN: 샷별 프레임 생성 — START_END 샷은 시작·끝 2장(드롭/후보 순서 유지) */
  private async stageFrames(episodeId: string): Promise<void> {
    const { topic, preset, dirs } = this.context(episodeId);
    const shots = this.dao.shots.listByEpisode(episodeId);
    if (shots.length === 0) throw new Error("샷리스트가 없다");

    await mkdir(dirs.frames, { recursive: true });
    const { adapter, name } = this.adapters.image(dirs.frames);
    const references = this.dao.masterAssets
      .listByTopic(topic.id)
      .map((m) => m.file_path);

    await Promise.all(
      shots.map(async (shot) => {
        if (shot.gen_method === "T2V" || shot.gen_method === "EDIT_ONLY") return;
        const round = maxRound(this.dao.generatedAssets.listByShot(shot.id), "frame") + 1;
        const count = shot.gen_method === "START_END" ? 2 : 1;
        const done = await this.runner.run(
          {
            episodeId,
            shotId: shot.id,
            kind: "frame_gen",
            adapter: name,
            payload: { idx: shot.idx, count, prompt: shot.image_prompt },
          },
          adapter,
          () =>
            adapter.generate({
              prompt: shot.image_prompt,
              referenceImagePaths: references,
              aspect: preset.format.aspect,
              count,
            }),
        );
        const files = done.output.imageFilePaths;
        if (files.length < count) {
          throw new Error(
            `샷 ${shot.idx}: 프레임 ${count}장 필요, ${files.length}장 수신`,
          );
        }
        for (const [n, src] of files.entries()) {
          const dest = await this.copyInto(
            src,
            dirs.frames,
            `shot-${shot.idx}-r${round}-${n}`,
          );
          this.dao.generatedAssets.insert({
            id: randomUUID(),
            shot_id: shot.id,
            kind: "frame",
            file_path: dest,
            gen_round: round,
            approved: null,
            reject_reason: null,
            meta_json: JSON.stringify({ prompt: shot.image_prompt, order: n }),
          });
        }
      }),
    );
  }

  /**
   * 샷의 최신 라운드 프레임 목록 — meta_json.order 로 정렬한다
   * (동일 ms 삽입은 created_at 이 같아 DB 정렬만으로는 시작·끝 순서가 흔들린다).
   */
  private latestFrames(shot: ShotRow): GeneratedAssetRow[] {
    const assets = this.dao.generatedAssets
      .listByShot(shot.id)
      .filter((a) => a.kind === "frame");
    const round = maxRound(assets, "frame");
    const orderOf = (a: GeneratedAssetRow): number => {
      try {
        const meta = JSON.parse(a.meta_json ?? "{}") as { order?: number };
        return meta.order ?? 0;
      } catch {
        return 0;
      }
    };
    return assets
      .filter((a) => a.gen_round === round)
      .sort((x, y) => orderOf(x) - orderOf(y));
  }

  /** VIDEO_GEN: 샷별 클립 생성 — I2V/T2V 직접, START_END 는 강등 체인 경유 */
  private async stageVideos(episodeId: string): Promise<void> {
    const shots = this.dao.shots.listByEpisode(episodeId);
    if (shots.length === 0) throw new Error("샷리스트가 없다");
    const { dirs } = this.context(episodeId);

    await mkdir(dirs.clips, { recursive: true });
    const { adapter: video, name } = this.adapters.video(dirs.clips);

    await Promise.all(
      shots.map(async (shot) => {
        if (shot.gen_method === "EDIT_ONLY") return; // 기존 소스 재활용 — 생성 없음
        const round = maxRound(this.dao.generatedAssets.listByShot(shot.id), "clip") + 1;

        let clipPaths: string[];
        if (shot.gen_method === "START_END") {
          const frames = this.latestFrames(shot);
          if (frames.length < 2) {
            throw new Error(`샷 ${shot.idx}: START_END 프레임 2장이 없다`);
          }
          const result = await runStartEndShot(
            {
              dao: this.dao,
              runner: this.runner,
              chain: new StartEndChain(
                this.adapters.videoApiOrStub(dirs.clips),
                this.adapters.manual.video,
              ),
              api: this.adapters.videoApiOrStub(dirs.clips),
              manual: this.adapters.manual.video,
            },
            shot,
            {
              startFramePath: frames[0].file_path,
              endFramePath: frames[1].file_path,
              motionPrompt: shot.motion_prompt,
              duration_ms: shot.duration_ms,
            },
          );
          clipPaths = result.clipFilePaths;
        } else if (shot.gen_method === "T2V") {
          const done = await this.runner.run(
            {
              episodeId,
              shotId: shot.id,
              kind: "video_t2v",
              adapter: name,
              payload: { idx: shot.idx },
            },
            video,
            () =>
              video.t2v({
                prompt: shot.motion_prompt,
                duration_ms: shot.duration_ms,
              }),
          );
          clipPaths = done.output.clipFilePaths;
        } else {
          const frames = this.latestFrames(shot);
          if (frames.length === 0) {
            throw new Error(`샷 ${shot.idx}: I2V 시작 프레임이 없다`);
          }
          const done = await this.runner.run(
            {
              episodeId,
              shotId: shot.id,
              kind: "video_i2v",
              adapter: name,
              payload: { idx: shot.idx },
            },
            video,
            () =>
              video.i2v({
                imagePath: frames[0].file_path,
                motionPrompt: shot.motion_prompt,
                duration_ms: shot.duration_ms,
              }),
          );
          clipPaths = done.output.clipFilePaths;
        }

        for (const [n, src] of clipPaths.entries()) {
          const dest = await this.copyInto(
            src,
            dirs.clips,
            `shot-${shot.idx}-r${round}-${n}`,
          );
          this.dao.generatedAssets.insert({
            id: randomUUID(),
            shot_id: shot.id,
            kind: "clip",
            file_path: dest,
            gen_round: round,
            approved: null,
            reject_reason: null,
            meta_json: JSON.stringify({ motion_prompt: shot.motion_prompt, order: n }),
          });
        }
      }),
    );
  }

  /** ASSEMBLY: GATE3 채택 클립 + 문장 TTS 로 final/final.mp4 조립 → 비용·지표 반영 */
  private async stageAssembly(episodeId: string): Promise<void> {
    const { dirs } = this.context(episodeId);
    const shots = this.dao.shots.listByEpisode(episodeId);
    if (shots.length === 0) throw new Error("샷리스트가 없다");

    const cuts = shots.map((shot) => {
      if (!shot.adopted_asset_id) {
        throw new Error(`샷 ${shot.idx}: GATE3 채택이 없다`);
      }
      const clip = this.dao.generatedAssets.get(shot.adopted_asset_id);
      if (!clip) throw new Error(`샷 ${shot.idx}: 채택 클립 없음 (${shot.adopted_asset_id})`);
      const audio = this.dao.generatedAssets
        .listByShot(shot.id)
        .find((a) => a.kind === "tts_audio");
      if (!audio) throw new Error(`샷 ${shot.idx}: TTS 오디오가 없다`);
      return {
        clipPath: clip.file_path,
        audioPath: audio.file_path,
        in_ms: shot.adopted_in_ms ?? 0,
      };
    });

    await mkdir(dirs.final, { recursive: true });
    const outPath = path.join(dirs.final, "final.mp4");
    const result = await assembleEpisode(cuts, outPath);
    this.dao.episodes.updateMetrics(
      episodeId,
      JSON.stringify({
        final_path: outPath,
        final_duration_ms: result.duration_ms,
        cut_durations_ms: result.cutDurationsMs,
      }),
    );
    persistEpisodeCost(this.dao, episodeId);
  }
}

export function createWiredPipeline(options: WiredPipelineOptions): WiredPipeline {
  return new WiredPipelineService(options);
}
