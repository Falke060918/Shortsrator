/**
 * prepared-statement DAO — 스키마(migrations/001_init.sql)를 그대로 비추는 얇은 계층.
 * - Row 타입은 컬럼을 snake_case 그대로 노출한다 (shared/src/domain.ts 표기 규칙).
 * - *_json 컬럼은 직렬화 문자열 그대로 다룬다 — 파싱/직렬화는 호출자(파이프라인) 책임.
 * - 모든 문장은 createDao 시점에 1회 prepare된다.
 */
import type {
  EpisodeState,
  Gate,
  GateDecisionValue,
  GenMethod,
  JobStatus,
  ThemeStatus,
  TransitionType,
} from "@shortsrator/shared";
import type { Db } from "./db.js";

// ---------------------------------------------------------------- Row 타입

export interface ThemeRow {
  id: string;
  name: string;
  status: ThemeStatus;
  channel_id: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}
export type NewTheme = Omit<ThemeRow, "created_at" | "updated_at">;

export interface ThemeVersionRow {
  id: string;
  theme_id: string;
  version_no: number;
  rules_json: string;
  changelog: string;
  created_at: string;
}
export type NewThemeVersion = Omit<ThemeVersionRow, "created_at">;

export interface TopicRow {
  id: string;
  theme_id: string;
  title: string;
  status: string;
  source: string | null;
  created_at: string;
}
export type NewTopic = Omit<TopicRow, "created_at">;

export interface EpisodeRow {
  id: string;
  theme_version_id: string;
  topic_id: string;
  state: EpisodeState;
  metrics_json: string | null;
  cost_json: string | null;
  created_at: string;
  updated_at: string;
}
export type NewEpisode = Omit<EpisodeRow, "created_at" | "updated_at">;

export interface ShotRow {
  id: string;
  episode_id: string;
  idx: number;
  narration: string;
  /** 수정 1: ms 정수 (TTS ffprobe 실측) */
  duration_ms: number;
  gen_method: GenMethod;
  camera_moves_json: string;
  image_prompt: string;
  motion_prompt: string;
  transition_type: TransitionType | null;
  fallback_json: string;
  adopted_asset_id: string | null;
  adopted_in_ms: number | null;
  adopted_out_ms: number | null;
}
export type NewShot = ShotRow;

export interface GeneratedAssetRow {
  id: string;
  shot_id: string;
  kind: string;
  file_path: string;
  gen_round: number;
  /** NULL=미판정, 1=승인, 0=반려 */
  approved: 0 | 1 | null;
  reject_reason: string | null;
  /** 수정 3: 모델·seed·motion_id·사용 프롬프트 (재현성) */
  meta_json: string | null;
  created_at: string;
}
export type NewGeneratedAsset = Omit<GeneratedAssetRow, "created_at">;

export interface MasterAssetRow {
  id: string;
  topic_id: string;
  role: string;
  file_path: string;
  created_at: string;
}
export type NewMasterAsset = Omit<MasterAssetRow, "created_at">;

export interface GateDecisionRow {
  id: string;
  episode_id: string;
  gate: Gate;
  decision: GateDecisionValue;
  payload_json: string | null;
  decided_at: string;
}
export type NewGateDecision = Omit<GateDecisionRow, "decided_at">;

/** 수정 2: 비용 추적(§10)·크래시 재개·MANUAL 대기의 원천 */
export interface JobRow {
  id: string;
  episode_id: string;
  shot_id: string | null;
  kind: string;
  adapter: string;
  status: JobStatus;
  request_id: string | null;
  cost_credits: number | null;
  cost_krw: number | null;
  payload_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export type NewJob = Omit<JobRow, "created_at" | "updated_at">;

// ---------------------------------------------------------------- DAO

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function createDao(db: Db) {
  // themes
  const insertTheme = db.prepare(
    `INSERT INTO themes (id, name, status, channel_id, current_version_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const getTheme = db.prepare("SELECT * FROM themes WHERE id = ?");
  const listThemes = db.prepare("SELECT * FROM themes ORDER BY created_at, id");
  const updateThemeStatus = db.prepare(
    `UPDATE themes SET status = ?, updated_at = ${NOW} WHERE id = ?`,
  );
  const setThemeCurrentVersion = db.prepare(
    `UPDATE themes SET current_version_id = ?, updated_at = ${NOW} WHERE id = ?`,
  );

  // theme_versions
  const insertThemeVersion = db.prepare(
    `INSERT INTO theme_versions (id, theme_id, version_no, rules_json, changelog)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const getThemeVersion = db.prepare(
    "SELECT * FROM theme_versions WHERE id = ?",
  );
  const listThemeVersionsByTheme = db.prepare(
    "SELECT * FROM theme_versions WHERE theme_id = ? ORDER BY version_no",
  );

  // topics
  const insertTopic = db.prepare(
    `INSERT INTO topics (id, theme_id, title, status, source)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const getTopic = db.prepare("SELECT * FROM topics WHERE id = ?");
  const listTopicsByTheme = db.prepare(
    "SELECT * FROM topics WHERE theme_id = ? ORDER BY created_at, id",
  );
  const updateTopicStatus = db.prepare(
    "UPDATE topics SET status = ? WHERE id = ?",
  );

  // episodes
  const insertEpisode = db.prepare(
    `INSERT INTO episodes (id, theme_version_id, topic_id, state, metrics_json, cost_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const getEpisode = db.prepare("SELECT * FROM episodes WHERE id = ?");
  const listEpisodes = db.prepare(
    "SELECT * FROM episodes ORDER BY created_at, id",
  );
  const listEpisodesByState = db.prepare(
    "SELECT * FROM episodes WHERE state = ? ORDER BY created_at, id",
  );
  const updateEpisodeState = db.prepare(
    `UPDATE episodes SET state = ?, updated_at = ${NOW} WHERE id = ?`,
  );
  const updateEpisodeMetrics = db.prepare(
    `UPDATE episodes SET metrics_json = ?, updated_at = ${NOW} WHERE id = ?`,
  );
  const updateEpisodeCost = db.prepare(
    `UPDATE episodes SET cost_json = ?, updated_at = ${NOW} WHERE id = ?`,
  );

  // shots
  const insertShot = db.prepare(
    `INSERT INTO shots (id, episode_id, idx, narration, duration_ms, gen_method,
                        camera_moves_json, image_prompt, motion_prompt,
                        transition_type, fallback_json,
                        adopted_asset_id, adopted_in_ms, adopted_out_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getShot = db.prepare("SELECT * FROM shots WHERE id = ?");
  const listShotsByEpisode = db.prepare(
    "SELECT * FROM shots WHERE episode_id = ? ORDER BY idx",
  );
  const adoptShot = db.prepare(
    `UPDATE shots SET adopted_asset_id = ?, adopted_in_ms = ?, adopted_out_ms = ?
     WHERE id = ?`,
  );
  const updateShotTransition = db.prepare(
    "UPDATE shots SET transition_type = ? WHERE id = ?",
  );

  const runInsertShot = (s: NewShot) => {
    insertShot.run(
      s.id,
      s.episode_id,
      s.idx,
      s.narration,
      s.duration_ms,
      s.gen_method,
      s.camera_moves_json,
      s.image_prompt,
      s.motion_prompt,
      s.transition_type,
      s.fallback_json,
      s.adopted_asset_id,
      s.adopted_in_ms,
      s.adopted_out_ms,
    );
  };

  // generated_assets
  const insertGeneratedAsset = db.prepare(
    `INSERT INTO generated_assets (id, shot_id, kind, file_path, gen_round,
                                   approved, reject_reason, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getGeneratedAsset = db.prepare(
    "SELECT * FROM generated_assets WHERE id = ?",
  );
  const listGeneratedAssetsByShot = db.prepare(
    "SELECT * FROM generated_assets WHERE shot_id = ? ORDER BY gen_round, created_at, id",
  );
  const setGeneratedAssetApproval = db.prepare(
    "UPDATE generated_assets SET approved = ?, reject_reason = ? WHERE id = ?",
  );

  // master_assets
  const insertMasterAsset = db.prepare(
    `INSERT INTO master_assets (id, topic_id, role, file_path)
     VALUES (?, ?, ?, ?)`,
  );
  const listMasterAssetsByTopic = db.prepare(
    "SELECT * FROM master_assets WHERE topic_id = ? ORDER BY role, id",
  );

  // gate_decisions
  const insertGateDecision = db.prepare(
    `INSERT INTO gate_decisions (id, episode_id, gate, decision, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const listGateDecisionsByEpisode = db.prepare(
    "SELECT * FROM gate_decisions WHERE episode_id = ? ORDER BY decided_at, rowid",
  );

  // jobs
  const insertJob = db.prepare(
    `INSERT INTO jobs (id, episode_id, shot_id, kind, adapter, status,
                       request_id, cost_credits, cost_krw, payload_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getJob = db.prepare("SELECT * FROM jobs WHERE id = ?");
  const updateJobStatus = db.prepare(
    `UPDATE jobs SET status = ?, error = ?, updated_at = ${NOW} WHERE id = ?`,
  );
  const setJobRequestId = db.prepare(
    `UPDATE jobs SET request_id = ?, updated_at = ${NOW} WHERE id = ?`,
  );
  const setJobCost = db.prepare(
    `UPDATE jobs SET cost_credits = ?, cost_krw = ?, updated_at = ${NOW} WHERE id = ?`,
  );
  const listJobsByStatus = db.prepare(
    "SELECT * FROM jobs WHERE status = ? ORDER BY created_at, id",
  );
  const listJobsByEpisode = db.prepare(
    "SELECT * FROM jobs WHERE episode_id = ? ORDER BY created_at, id",
  );

  // settings
  const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const allSettings = db.prepare("SELECT key, value FROM settings");

  return {
    themes: {
      insert(t: NewTheme): void {
        insertTheme.run(t.id, t.name, t.status, t.channel_id, t.current_version_id);
      },
      get: (id: string) => getTheme.get<ThemeRow>(id),
      list: () => listThemes.all<ThemeRow>(),
      updateStatus(id: string, status: ThemeStatus): void {
        updateThemeStatus.run(status, id);
      },
      setCurrentVersion(id: string, versionId: string | null): void {
        setThemeCurrentVersion.run(versionId, id);
      },
    },

    themeVersions: {
      insert(v: NewThemeVersion): void {
        insertThemeVersion.run(v.id, v.theme_id, v.version_no, v.rules_json, v.changelog);
      },
      get: (id: string) => getThemeVersion.get<ThemeVersionRow>(id),
      listByTheme: (themeId: string) =>
        listThemeVersionsByTheme.all<ThemeVersionRow>(themeId),
    },

    topics: {
      insert(t: NewTopic): void {
        insertTopic.run(t.id, t.theme_id, t.title, t.status, t.source);
      },
      get: (id: string) => getTopic.get<TopicRow>(id),
      listByTheme: (themeId: string) => listTopicsByTheme.all<TopicRow>(themeId),
      updateStatus(id: string, status: string): void {
        updateTopicStatus.run(status, id);
      },
    },

    episodes: {
      insert(e: NewEpisode): void {
        insertEpisode.run(
          e.id,
          e.theme_version_id,
          e.topic_id,
          e.state,
          e.metrics_json,
          e.cost_json,
        );
      },
      get: (id: string) => getEpisode.get<EpisodeRow>(id),
      list: () => listEpisodes.all<EpisodeRow>(),
      listByState: (state: EpisodeState) =>
        listEpisodesByState.all<EpisodeRow>(state),
      updateState(id: string, state: EpisodeState): void {
        updateEpisodeState.run(state, id);
      },
      updateMetrics(id: string, metricsJson: string): void {
        updateEpisodeMetrics.run(metricsJson, id);
      },
      updateCost(id: string, costJson: string): void {
        updateEpisodeCost.run(costJson, id);
      },
    },

    shots: {
      insert: runInsertShot,
      /** 샷리스트 일괄 삽입 — 하나라도 실패하면 전체 롤백 */
      insertMany(shots: NewShot[]): void {
        db.transaction(() => {
          for (const s of shots) runInsertShot(s);
        });
      },
      get: (id: string) => getShot.get<ShotRow>(id),
      listByEpisode: (episodeId: string) => listShotsByEpisode.all<ShotRow>(episodeId),
      /** GATE3 클립 채택 — in/out은 0.1초=100ms 단위 입력 */
      adopt(id: string, assetId: string, inMs: number, outMs: number): void {
        adoptShot.run(assetId, inMs, outMs, id);
      },
      /** START_END 전환 강등 체인 진행 (frames → edit_splice → manual) */
      updateTransition(id: string, transitionType: TransitionType): void {
        updateShotTransition.run(transitionType, id);
      },
    },

    generatedAssets: {
      insert(a: NewGeneratedAsset): void {
        insertGeneratedAsset.run(
          a.id,
          a.shot_id,
          a.kind,
          a.file_path,
          a.gen_round,
          a.approved,
          a.reject_reason,
          a.meta_json,
        );
      },
      get: (id: string) => getGeneratedAsset.get<GeneratedAssetRow>(id),
      listByShot: (shotId: string) =>
        listGeneratedAssetsByShot.all<GeneratedAssetRow>(shotId),
      /** 승인/반려 판정 — 승인 시 reject_reason은 비운다 */
      setApproval(id: string, approved: boolean, rejectReason?: string): void {
        setGeneratedAssetApproval.run(
          approved ? 1 : 0,
          approved ? null : (rejectReason ?? null),
          id,
        );
      },
    },

    masterAssets: {
      insert(m: NewMasterAsset): void {
        insertMasterAsset.run(m.id, m.topic_id, m.role, m.file_path);
      },
      listByTopic: (topicId: string) =>
        listMasterAssetsByTopic.all<MasterAssetRow>(topicId),
    },

    gateDecisions: {
      insert(g: NewGateDecision): void {
        insertGateDecision.run(g.id, g.episode_id, g.gate, g.decision, g.payload_json);
      },
      listByEpisode: (episodeId: string) =>
        listGateDecisionsByEpisode.all<GateDecisionRow>(episodeId),
    },

    jobs: {
      insert(j: NewJob): void {
        insertJob.run(
          j.id,
          j.episode_id,
          j.shot_id,
          j.kind,
          j.adapter,
          j.status,
          j.request_id,
          j.cost_credits,
          j.cost_krw,
          j.payload_json,
          j.error,
        );
      },
      get: (id: string) => getJob.get<JobRow>(id),
      updateStatus(id: string, status: JobStatus, error?: string): void {
        updateJobStatus.run(status, error ?? null, id);
      },
      setRequestId(id: string, requestId: string): void {
        setJobRequestId.run(requestId, id);
      },
      setCost(id: string, credits: number | null, krw: number | null): void {
        setJobCost.run(credits, krw, id);
      },
      listByStatus: (status: JobStatus) => listJobsByStatus.all<JobRow>(status),
      listByEpisode: (episodeId: string) => listJobsByEpisode.all<JobRow>(episodeId),
    },

    settings: {
      get(key: string): string | undefined {
        return getSetting.get<{ value: string }>(key)?.value;
      },
      set(key: string, value: string): void {
        upsertSetting.run(key, value);
      },
      all(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const row of allSettings.all<{ key: string; value: string }>()) {
          out[row.key] = row.value;
        }
        return out;
      },
    },
  };
}

export type Dao = ReturnType<typeof createDao>;
