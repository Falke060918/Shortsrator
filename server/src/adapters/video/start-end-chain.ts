/**
 * start_end_video 자동 강등 체인 — frames → edit_splice → manual
 * (docs/03-architecture.md "start_end_video는 시스템 기능",
 *  docs/시작끝프레임처리 -claude.txt 폴백 A).
 *
 * - frames: Higgsfield startEnd(API) 1건. 미지원 거부(4xx)·오류 시 강등.
 * - edit_splice: 스펙 분해만 — 실제 클립 생성 호출은 I2V 2건으로 표현
 *   (시작 프레임 전진 클립 + 끝 프레임 리빌 클립), 접합은 플래시/가림 스플라이스.
 *   단순 dissolve 금지 (03-architecture). 실제 접합 실행은 ffmpeg-assembly 소관.
 * - manual: 지시서 + 드롭 — 항상 성립하는 종단.
 */

import type {
  JobHandle,
  StartEndInput,
  TransitionType,
  VideoAdapter,
} from "@shortsrator/shared";
import { TRANSITION_TYPES } from "@shortsrator/shared";
import type { ManualVideoAdapter } from "../manual/manual-adapters.js";

/** 플래시 스플라이스 기본 길이(ms 정수) */
export const DEFAULT_FLASH_DURATION_MS = 120;

/** 접합 스펙 — dissolve는 타입 차원에서 배제 */
export interface SpliceSpec {
  /** flash(화이트 플래시) | cover(휩팬/마스크 가림) — dissolve 금지 */
  kind: "flash" | "cover";
  /** 접합 시점(클립 전체 기준 ms) */
  atMs: number;
  flashDurationMs: number;
}

export type StartEndPlan =
  | { transition: "frames"; handle: JobHandle }
  | {
      transition: "edit_splice";
      /** 시작 프레임 전진 클립 (전반부) */
      startClip: JobHandle;
      /** 끝 프레임 리빌 클립 (후반부) */
      endClip: JobHandle;
      splice: SpliceSpec;
    }
  | { transition: "manual"; handle: JobHandle };

/** 체인 소진(구성상 manual이 빠졌을 때만 가능) */
export class StartEndChainExhaustedError extends Error {
  constructor(readonly attempts: string[]) {
    super(`start_end 강등 체인 소진: ${attempts.join(" / ")}`);
    this.name = "StartEndChainExhaustedError";
  }
}

export class StartEndChain {
  constructor(
    private readonly api: VideoAdapter,
    private readonly manual: ManualVideoAdapter,
  ) {}

  /**
   * chain(샷 스펙의 [transition_type, ...fallback])을 순서대로 시도한다.
   * 각 단계 실패는 다음 단계로 강등 — manual은 실패하지 않으므로 사실상 종단.
   */
  async run(
    input: StartEndInput,
    chain: readonly TransitionType[] = TRANSITION_TYPES,
  ): Promise<StartEndPlan> {
    const attempts: string[] = [];
    for (const transition of chain) {
      try {
        switch (transition) {
          case "frames":
            return { transition, handle: await this.api.startEnd(input) };
          case "edit_splice":
            return await this.planEditSplice(input);
          case "manual":
            return { transition, handle: await this.manual.startEnd(input) };
        }
      } catch (err) {
        attempts.push(
          `${transition}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    throw new StartEndChainExhaustedError(attempts);
  }

  /** edit_splice 스펙 분해 — I2V 2건 제출 + 접합 스펙 (조립 실행은 범위 밖) */
  private async planEditSplice(input: StartEndInput): Promise<StartEndPlan> {
    const frontMs = Math.floor(input.duration_ms / 2);
    const backMs = input.duration_ms - frontMs;
    const startClip = await this.api.i2v({
      imagePath: input.startFramePath,
      motionPrompt: `${input.motionPrompt} — forward motion toward the transition point`,
      duration_ms: frontMs,
    });
    const endClip = await this.api.i2v({
      imagePath: input.endFramePath,
      motionPrompt: `${input.motionPrompt} — settle and reveal from the transition point`,
      duration_ms: backMs,
    });
    return {
      transition: "edit_splice",
      startClip,
      endClip,
      splice: {
        kind: "flash",
        atMs: frontMs,
        flashDurationMs: DEFAULT_FLASH_DURATION_MS,
      },
    };
  }
}
