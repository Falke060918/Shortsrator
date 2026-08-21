import { EPISODE_STATES, GATES } from "@shortsrator/shared";
import type { EpisodeState, Gate, GateDecisionRecord } from "@shortsrator/shared";

/** 화면 표시용 5단계 — 목업의 스테퍼/미니 파이프 구성 */
export const DISPLAY_STAGES = [
  { no: 1, name: "대본", sub: "5컷" },
  { no: 2, name: "TTS", sub: "실측 16.2s" },
  { no: 3, name: "첫 프레임", sub: "후보 생성" },
  { no: 4, name: "클립 (I2V)", sub: "발췌" },
  { no: 5, name: "조립", sub: "ffmpeg · 9:16" },
] as const;

/** EpisodeState → 표시 단계 인덱스(0~4). PUBLISHED는 5(전부 완료). */
const stageIndexOf: Record<EpisodeState, number> = {
  TOPIC: 0,
  SCRIPT: 0,
  SCRIPT_GATE: 0,
  TTS: 1,
  SHOTLIST: 2,
  MASTER_ASSET: 2,
  FRAME_GEN: 2,
  FRAME_GATE: 2,
  VIDEO_GEN: 3,
  CLIP_GATE: 3,
  ASSEMBLY: 4,
  FINAL_GATE: 4,
  UPLOAD: 4,
  PUBLISHED: 5,
};

export type StageStatus = "done" | "now" | "todo";
export type GateStatus = "passed" | "waiting" | "locked";

export function stageStatuses(state: EpisodeState): StageStatus[] {
  const cur = stageIndexOf[state];
  return DISPLAY_STAGES.map((_, i) =>
    i < cur ? "done" : i === cur ? "now" : "todo",
  );
}

export function gateStatuses(
  state: EpisodeState,
  history: GateDecisionRecord[],
): Record<Gate, GateStatus> {
  const cur = EPISODE_STATES.indexOf(state);
  const out = {} as Record<Gate, GateStatus>;
  for (const gate of GATES) {
    const gi = EPISODE_STATES.indexOf(gate);
    const approved = history.some(
      (h) => h.gate === gate && h.decision === "approve",
    );
    out[gate] = approved || cur > gi ? "passed" : cur === gi ? "waiting" : "locked";
  }
  return out;
}
