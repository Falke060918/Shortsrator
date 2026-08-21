/**
 * API DTO — 기준 문서: docs/03-architecture.md "API 계약 (주요 엔드포인트)".
 * 요청/응답 필드는 계약 표기 그대로 camelCase를 쓴다 ({topicId}, {assetId, inMs, outMs}, {toState}).
 */

import type {
  EpisodeState,
  Gate,
  GateDecisionValue,
  ShotSpec,
} from "./domain.js";
import type { AdapterMode, CostMeta, JobStatus } from "./adapters.js";

// ---------------------------------------------------------------- GET /api/state

/** 대시보드 집계: 에피소드 + 대기 게이트 + 주제 큐 */
export interface StateResponse {
  episodes: EpisodeSummary[];
  pendingGates: PendingGate[];
  topicQueue: TopicSummary[];
}

export interface EpisodeSummary {
  id: string;
  topicTitle: string;
  state: EpisodeState;
  updatedAt: string;
}

export interface PendingGate {
  episodeId: string;
  gate: Gate;
  since: string;
}

export interface TopicSummary {
  id: string;
  title: string;
  status: string;
}

// ---------------------------------------------------------------- /api/episodes

/** POST /api/episodes — 에피소드 생성(TOPIC) */
export interface CreateEpisodeRequest {
  topicId: string;
}

/** GET /api/episodes/:id — 상세(샷·후보·게이트 이력·비용) */
export interface EpisodeDetailResponse {
  id: string;
  topicTitle: string;
  state: EpisodeState;
  shots: ShotSpec[];
  gateHistory: GateDecisionRecord[];
  cost: CostMeta;
}

export interface GateDecisionRecord {
  gate: Gate;
  decision: GateDecisionValue;
  payload?: unknown;
  decidedAt: string;
}

/** POST /api/episodes/:id/advance — 다음 자동 단계 실행(잡 투입) */
export interface AdvanceResponse {
  state: EpisodeState;
  jobId?: string;
}

/** POST /api/episodes/:id/gate — GATE1~4 승인/반려 */
export interface GateRequest {
  gate: Gate;
  decision: GateDecisionValue;
  payload?: unknown;
}

/** POST /api/shots/:id/adopt — GATE3 클립 채택 (0.1초=100ms 단위) */
export interface AdoptRequest {
  assetId: string;
  inMs: number;
  outMs: number;
}

/** POST /api/episodes/:id/rollback */
export interface RollbackRequest {
  toState: EpisodeState;
}

// ---------------------------------------------------------------- SSE (GET /api/episodes/:id/events)

/** 잡 진행·상태 전이 이벤트 — 폴백은 상태 폴링 */
export type ServerEvent =
  | { type: "job_progress"; jobId: string; status: JobStatus }
  | { type: "episode_state"; episodeId: string; state: EpisodeState };

// ---------------------------------------------------------------- GET/PUT /api/settings

export type TTSVendor = "elevenlabs" | "typecast";

/** 키 값 자체는 미노출 — UI에는 "설정됨/누락"만 */
export interface SettingsDTO {
  adapterModes: {
    llm: AdapterMode;
    tts: AdapterMode;
    image: AdapterMode;
    video: AdapterMode;
  };
  ttsVendor: TTSVendor;
  /** 편당 예산 한도(원) — 기준 3,000~5,000원 */
  budgetKrwPerEpisode: number;
  apiKeys: Record<string, "configured" | "missing">;
}

// ---------------------------------------------------------------- 공통

export interface HealthResponse {
  status: "ok";
}
