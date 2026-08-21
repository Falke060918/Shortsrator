/**
 * 게이트 정책 — 게이트 불가침 (issue #8, docs/03-architecture.md).
 *
 * GATE2(FRAME_GATE)·GATE3(CLIP_GATE)은 **어떤 설정으로도 스킵 불가**다.
 * 설정(gate_auto_approve)은 GATE1(SCRIPT_GATE)·GATE4(FINAL_GATE)의 자동 승인만
 * 허용하며, 파싱 단계에서 불가침 게이트를 무조건 걸러낸다 — 설정 값에 무엇이
 * 들어 있든 FRAME_GATE/CLIP_GATE 는 사용자 결정 없이는 통과할 수 없다.
 */

import { GATES, type EpisodeState, type Gate } from "@shortsrator/shared";

/** 어떤 설정으로도 스킵할 수 없는 게이트 (GATE2·GATE3) */
export const UNSKIPPABLE_GATES: readonly Gate[] = ["FRAME_GATE", "CLIP_GATE"];

/** settings KV 키 — 값은 자동 승인할 게이트 이름의 JSON 배열 */
export const GATE_AUTO_APPROVE_SETTING = "gate_auto_approve";

/** 게이트 승인 없이 게이트 상태를 벗어나려 할 때 */
export class GateNotApprovedError extends Error {
  constructor(readonly gate: Gate) {
    super(`게이트 승인 대기 중: ${gate} — 사용자 결정 없이는 진행할 수 없다`);
    this.name = "GateNotApprovedError";
  }
}

/** 현재 대기 중이 아닌 게이트에 결정을 넣으려 할 때 */
export class GateStateMismatchError extends Error {
  constructor(readonly gate: Gate, readonly currentState: EpisodeState) {
    super(`게이트 상태 불일치: ${gate} 결정 불가 (현재 상태 ${currentState})`);
    this.name = "GateStateMismatchError";
  }
}

function isGate(value: unknown): value is Gate {
  return (
    typeof value === "string" && (GATES as readonly string[]).includes(value)
  );
}

/**
 * gate_auto_approve 설정값 파싱. 어떤 입력이 오더라도(불가침 게이트 명시 포함)
 * 결과에서 UNSKIPPABLE_GATES 를 걸러낸다. 파싱 실패는 빈 목록.
 */
export function parseAutoApproveGates(raw: string | undefined): Gate[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isGate).filter((gate) => !UNSKIPPABLE_GATES.includes(gate));
}

/** 이 게이트가 설정으로 자동 승인 가능한가 — 불가침 게이트는 항상 false */
export function isAutoApprovable(gate: Gate, rawSetting: string | undefined): boolean {
  return parseAutoApproveGates(rawSetting).includes(gate);
}

/**
 * 게이트 반려 시 되돌아갈 재실행 단계 (01 문서 §2-3 예:
 * "프레임 게이트에서 '이미지 프롬프트가 문제' → FRAME_GEN 재실행").
 */
export function rejectTargetOf(gate: Gate): EpisodeState {
  switch (gate) {
    case "SCRIPT_GATE":
      return "SCRIPT";
    case "FRAME_GATE":
      return "FRAME_GEN";
    case "CLIP_GATE":
      return "VIDEO_GEN";
    case "FINAL_GATE":
      return "ASSEMBLY";
  }
}
