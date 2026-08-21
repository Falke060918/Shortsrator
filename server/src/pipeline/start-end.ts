/**
 * start_end_video 강등 체인 배선 — StartEndChain(어댑터 계층)을 잡 러너에 연결한다.
 *
 * 체인 실행(frames → edit_splice → manual)은 adapters/video/start-end-chain.ts 소관.
 * 여기서는 ① 샷의 [transition_type, ...fallback] 로 체인을 돌리고
 * ② 확정된 전환 방식을 shots.transition_type 에 기록하고(강등 결과 영속)
 * ③ 체인이 제출한 핸들들을 jobs 테이블에 attach 해 완료까지 추적한다.
 */

import type {
  StartEndInput,
  TransitionType,
  VideoAdapter,
  VideoOutput,
} from "@shortsrator/shared";
import { TRANSITION_TYPES } from "@shortsrator/shared";
import type { ManualVideoAdapter } from "../adapters/manual/manual-adapters.js";
import {
  StartEndChain,
  type SpliceSpec,
  type StartEndPlan,
} from "../adapters/video/start-end-chain.js";
import type { Dao, ShotRow } from "../db/dao.js";
import { JobRunner } from "./job-runner.js";

export interface StartEndDeps {
  dao: Dao;
  runner: JobRunner;
  chain: StartEndChain;
  /** 체인의 frames/edit_splice 단계가 쓰는 API 어댑터 (폴링용) */
  api: VideoAdapter;
  /** 체인의 manual 종단 어댑터 (폴링용) */
  manual: ManualVideoAdapter;
  /** jobs.adapter 에 기록할 API 어댑터 식별자 (기본 higgsfield) */
  apiAdapterName?: string;
}

export interface StartEndResult {
  /** 체인이 확정한 전환 방식 — shots.transition_type 에 기록됨 */
  transition: TransitionType;
  /** 생성된 클립 파일 경로 (edit_splice 는 [시작 클립…, 끝 클립…] 순) */
  clipFilePaths: string[];
  /** edit_splice 일 때만 — 접합 스펙 (실행은 ffmpeg-assembly 소관) */
  splice?: SpliceSpec;
}

function isTransitionType(value: unknown): value is TransitionType {
  return (
    typeof value === "string" &&
    (TRANSITION_TYPES as readonly string[]).includes(value)
  );
}

/** 샷 스펙의 [transition_type, ...fallback] — 손상된 JSON 은 기본 체인으로 폴백 */
export function chainOf(shot: ShotRow): TransitionType[] {
  let fallback: unknown;
  try {
    fallback = JSON.parse(shot.fallback_json);
  } catch {
    fallback = [];
  }
  const chain = [
    shot.transition_type,
    ...(Array.isArray(fallback) ? fallback : []),
  ].filter(isTransitionType);
  return chain.length > 0 ? chain : [...TRANSITION_TYPES];
}

/**
 * START_END 샷 1개 실행 — 체인 강등 결과를 샷에 기록하고,
 * 제출된 클립 잡 전부를 jobs 테이블로 추적해 완료까지 기다린다.
 */
export async function runStartEndShot(
  deps: StartEndDeps,
  shot: ShotRow,
  input: StartEndInput,
): Promise<StartEndResult> {
  const { dao, runner, chain, api, manual } = deps;
  const apiAdapterName = deps.apiAdapterName ?? "higgsfield";
  if (shot.gen_method !== "START_END") {
    throw new Error(`START_END 샷이 아니다: ${shot.id} (${shot.gen_method})`);
  }

  const plan: StartEndPlan = await chain.run(input, chainOf(shot));
  // 강등 결과 영속 — 이후 재실행·집계는 확정된 전환 방식 기준
  dao.shots.updateTransition(shot.id, plan.transition);

  const base = { episodeId: shot.episode_id, shotId: shot.id };
  switch (plan.transition) {
    case "frames": {
      const done = await runner.attach<VideoOutput>(
        { ...base, kind: "video_start_end", adapter: apiAdapterName },
        api,
        plan.handle,
      );
      return { transition: "frames", clipFilePaths: done.output.clipFilePaths };
    }
    case "edit_splice": {
      // I2V 2클립 병렬 추적 — 접합(플래시/가림 스플라이스)은 ffmpeg-assembly 소관
      const [start, end] = await Promise.all([
        runner.attach<VideoOutput>(
          { ...base, kind: "video_splice_start", adapter: apiAdapterName },
          api,
          plan.startClip,
        ),
        runner.attach<VideoOutput>(
          { ...base, kind: "video_splice_end", adapter: apiAdapterName },
          api,
          plan.endClip,
        ),
      ]);
      return {
        transition: "edit_splice",
        clipFilePaths: [
          ...start.output.clipFilePaths,
          ...end.output.clipFilePaths,
        ],
        splice: plan.splice,
      };
    }
    case "manual": {
      const done = await runner.attach<VideoOutput>(
        { ...base, kind: "video_start_end", adapter: "manual" },
        manual,
        plan.handle,
      );
      return { transition: "manual", clipFilePaths: done.output.clipFilePaths };
    }
  }
}
