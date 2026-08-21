/**
 * Fixture 데이터 — shared DTO 타입(@shortsrator/shared)에 맞춘 더미.
 * 서버 연동 배선은 #9(api-server) 범위 — 이 파일이 GET /api/state,
 * GET /api/episodes/:id 응답 자리를 대신한다.
 * 시나리오: EP-003 "판테온 돔" 이 GATE2(첫 프레임)에서 대기 중 (승인 목업과 동일).
 */

import type {
  EpisodeDetailResponse,
  ShotSpec,
  StateResponse,
} from "@shortsrator/shared";

// ---------------------------------------------------------------- 대시보드 (GET /api/state)

export const stateFixture: StateResponse = {
  episodes: [
    {
      id: "EP-003",
      topicTitle: "판테온 돔은 왜 무너지지 않는가",
      state: "FRAME_GATE",
      updatedAt: "2026-08-20T14:00:00+09:00",
    },
    {
      id: "EP-002",
      topicTitle: "아무도 이 다리의 아래를 본 적이 없습니다",
      state: "PUBLISHED",
      updatedAt: "2026-08-14T18:00:00+09:00",
    },
    {
      id: "EP-001",
      topicTitle: "비밀은 지하 20미터에 있었습니다",
      state: "PUBLISHED",
      updatedAt: "2026-08-07T18:00:00+09:00",
    },
  ],
  pendingGates: [
    { episodeId: "EP-003", gate: "FRAME_GATE", since: "2026-08-20T14:00:00+09:00" },
  ],
  topicQueue: [
    { id: "T-01", title: "대형 현수교의 하부 지지 구조", status: "숨겨진 구조" },
    { id: "T-02", title: "댐 내부에서 수압이 분산되는 방식", status: "왜 안 무너지나" },
    { id: "T-03", title: "경기장 지붕의 케이블 구조", status: "숨겨진 구조" },
    { id: "T-04", title: "지하 20미터의 고대 저수조", status: "숨겨진 구조" },
    { id: "T-05", title: "초고층 빌딩의 튜닝 매스 댐퍼", status: "왜 안 무너지나" },
    { id: "T-06", title: "심해에 존재하는 미스터리 유적지", status: "불가능한 건축" },
  ],
};

/** 테마 품질 지표 (최근 10회 생성) — 서버 집계 예정, 지금은 더미 */
export const qualityStats = [
  { label: "첫 프레임 승인률", value: "42%", goal: "/ 목표 ≥40%", tone: "ok" as const },
  { label: "클립 채택률", value: "28%", goal: "/ 목표 ≥30%", tone: "warn" as const },
  { label: "편당 개입 시간", value: "47", goal: "min / 목표 ≤60", tone: "plain" as const },
];

// ---------------------------------------------------------------- 에피소드 상세 (GET /api/episodes/:id)

const shots: ShotSpec[] = [
  {
    id: "SHOT-C1",
    episode_id: "EP-003",
    idx: 0,
    narration: "이 돔은 2000년째 무너지지 않고 있습니다.",
    duration_ms: 3100,
    gen_method: "I2V",
    camera_moves: ["① slow push-in", "Wide establishing"],
    image_prompt: "Pantheon exterior, low angle wide establishing shot",
    motion_prompt: "slow push-in toward the dome",
    transition_type: "frames",
    fallback: ["edit_splice", "manual"],
  },
  {
    id: "SHOT-C2",
    episode_id: "EP-003",
    idx: 1,
    narration: "지름 43미터, 철근은 단 하나도 없습니다.",
    duration_ms: 2800,
    gen_method: "I2V",
    camera_moves: ["⑥ macro → pull back", "Detail"],
    image_prompt: "Pantheon interior detail, unreinforced concrete texture",
    motion_prompt: "macro detail then pull back",
    transition_type: "frames",
    fallback: ["edit_splice", "manual"],
  },
  {
    id: "SHOT-C3",
    episode_id: "EP-003",
    idx: 2,
    narration: "비밀은 위로 갈수록 가벼워지는 콘크리트에 있습니다.",
    duration_ms: 3400,
    gen_method: "I2V",
    camera_moves: ["④ fly-through", "내부 진입"],
    image_prompt: "Pantheon interior fly-through path",
    motion_prompt: "fly-through into the rotunda",
    transition_type: "frames",
    fallback: ["edit_splice", "manual"],
  },
  {
    id: "SHOT-C4",
    episode_id: "EP-003",
    idx: 3,
    narration: "돔의 무게는 두꺼운 벽을 타고 땅으로 흐릅니다.",
    duration_ms: 3000,
    gen_method: "START_END",
    camera_moves: ["Start+End", "외부 → 단면"],
    image_prompt: "Pantheon cross-section, load path visualization",
    motion_prompt: "exterior to cross-section transition",
    transition_type: "frames",
    fallback: ["edit_splice", "manual"],
  },
  {
    id: "SHOT-C5",
    episode_id: "EP-003",
    idx: 4,
    narration: "정점의 구멍, 오쿨루스가 이 돔을 완성합니다.",
    duration_ms: 3900,
    gen_method: "I2V",
    camera_moves: ["③ orbit", "Reveal"],
    image_prompt: "Oculus light beam, orbit reveal",
    motion_prompt: "orbit around the oculus light shaft",
    transition_type: "frames",
    fallback: ["edit_splice", "manual"],
  },
];

export const episodeFixture: EpisodeDetailResponse = {
  id: "EP-003",
  topicTitle: "판테온 돔은 왜 무너지지 않는가",
  state: "FRAME_GATE",
  shots,
  gateHistory: [
    { gate: "SCRIPT_GATE", decision: "approve", decidedAt: "2026-08-20T10:30:00+09:00" },
  ],
  cost: { credits: 118, krw: 2140 },
};

/** 컷 라벨(HOOK/REVEAL) — 테마 대본 규칙의 표시용 부가 정보 */
export const shotTags: Record<string, string | undefined> = {
  "SHOT-C1": "HOOK",
  "SHOT-C5": "REVEAL",
};

// ---------------------------------------------------------------- GATE2 첫 프레임 후보 (UI 전용 fixture)

/** 첫 프레임 후보 1장 — 서버 확정 전 UI 전용 형태 */
export interface FrameCandidate {
  id: string;
  label: string;
  seed: number;
  /** 그라디언트 placeholder 클래스 (실이미지 대용) */
  gradientClass: string;
}

/** 샷 id → 후보 목록. 비어 있으면 아직 후보 생성 전. */
export const frameCandidates: Record<string, FrameCandidate[]> = {
  "SHOT-C1": [
    { id: "CAND-A", label: "외부 전경 · 로우앵글", seed: 48213, gradientClass: "g-pantheon-ext" },
    { id: "CAND-B", label: "오쿨루스 광선 · 내부", seed: 51077, gradientClass: "g-oculus" },
    { id: "CAND-C", label: "단면 리컨스트럭션", seed: 49930, gradientClass: "g-cross" },
    { id: "CAND-D", label: "구조 컷어웨이", seed: 50412, gradientClass: "g-cutaway" },
  ],
  "SHOT-C2": [
    { id: "CAND-A", label: "내부 천장 디테일", seed: 52201, gradientClass: "g-pantheon-int" },
    { id: "CAND-B", label: "콘크리트 매크로", seed: 52548, gradientClass: "g-cross" },
  ],
};

/** 샷 id → 생성 회차 (반려 후 재생성 카운트) */
export const generationRound: Record<string, number> = {
  "SHOT-C1": 2,
  "SHOT-C2": 1,
};

// ---------------------------------------------------------------- GATE3 클립 후보 (UI 전용 fixture)

/** I2V 생성 클립 1개 — 발췌 대상. url은 로컬 fixture 비디오. */
export interface ClipAsset {
  assetId: string;
  label: string;
  /** 생성 회차 (샷당 2~3회) */
  take: number;
  url: string;
  /** 클립 원본 길이(ms) — 8초 생성 기준 */
  duration_ms: number;
}

/** 샷 id → 클립 목록. 비어 있으면 아직 클립 생성 전. */
export const clipAssets: Record<string, ClipAsset[]> = {
  "SHOT-C1": [
    { assetId: "CLIP-C1-T1", label: "push-in · 1회차", take: 1, url: "/fixtures/clip-r1.mp4", duration_ms: 8000 },
    { assetId: "CLIP-C1-T2", label: "push-in · 2회차", take: 2, url: "/fixtures/clip-r2.mp4", duration_ms: 8000 },
    { assetId: "CLIP-C1-T3", label: "push-in · 3회차", take: 3, url: "/fixtures/clip-r3.mp4", duration_ms: 8000 },
  ],
  "SHOT-C2": [
    { assetId: "CLIP-C2-T1", label: "pull back · 1회차", take: 1, url: "/fixtures/clip-r3.mp4", duration_ms: 8000 },
    { assetId: "CLIP-C2-T2", label: "pull back · 2회차", take: 2, url: "/fixtures/clip-r1.mp4", duration_ms: 8000 },
  ],
};

// ---------------------------------------------------------------- 테마 메타 (표시용)

export const themeMeta = {
  channel: "신비한건축사전",
  themeName: "신비한 건축 v1",
  themeStatus: "DRAFT",
  themeRef: "theme: architecture-mystery v1",
  adapterLine: "adapter: higgsfield-api → fallback: MANUAL",
  styleLock:
    "photorealistic architectural visualization, cinematic documentary lighting, physically accurate materials, museum-quality reconstruction, muted cool color grade, high structural detail, 9:16 vertical",
  masterAssets: [
    ["EXTERIOR", "외부 전경"],
    ["INTERIOR", "내부"],
    ["CROSS-SECTION", "단면도"],
    ["CUTAWAY", "구조 컷어웨이"],
  ] as const,
};
