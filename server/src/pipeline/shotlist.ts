/**
 * TTS 실측 → 샷리스트 → 컷 길이 산정 (01 문서 STEP 3·4).
 *
 * - 문장 단위로 TTS 를 합성한다 — 문장별 파일 길이(로컬 ffprobe 실측 ms)가
 *   곧 컷 길이다. 벤더 API 응답값이 아니다 (벤더 중립, 03-architecture).
 * - 내레이션 문장 1개 = 샷 1개 (1:1 매핑) — 컷 길이 duration_ms 는 실측값 그대로.
 * - START_END 샷에는 강등 체인 기본값(frames → edit_splice → manual)을 심는다.
 *
 * 샷 일괄 삽입은 dao.shots.insertMany(내부 트랜잭션)를 그대로 쓴다 —
 * 바깥에서 db.transaction 으로 감싸면 중첩 BEGIN 으로 터진다 (db.ts 주석).
 */

import { randomUUID } from "node:crypto";
import type {
  GenMethod,
  TransitionType,
  TTSAdapter,
  TTSOutput,
} from "@shortsrator/shared";
import type { Dao, NewShot, ShotRow } from "../db/dao.js";
import { JobRunner } from "./job-runner.js";

/** START_END 샷의 기본 강등 체인 시작점과 폴백 (03-architecture) */
export const DEFAULT_START_END_TRANSITION: TransitionType = "frames";
export const DEFAULT_START_END_FALLBACK: readonly TransitionType[] = [
  "edit_splice",
  "manual",
];

/** 샷리스트 1행 계획 — 내레이션 문장 1개 = 샷 1개 */
export interface SentencePlan {
  narration: string;
  gen_method: GenMethod;
  /** 테마 카메라 문법 7종 중 선택(+조합) */
  camera_moves: string[];
  /** 피사체·구도 기술 + 테마 style_string 고정 부착 (프롬프트 조립은 theme 소관) */
  image_prompt: string;
  motion_prompt: string;
  /** START_END 전용 — 미지정 시 기본 체인 */
  transition_type?: TransitionType;
  fallback?: TransitionType[];
}

export interface BuildShotlistInput {
  episodeId: string;
  /** 테마 voice_config 의 보이스 ID */
  voice: string;
  sentences: SentencePlan[];
}

export interface BuildShotlistDeps {
  dao: Dao;
  runner: JobRunner;
  tts: TTSAdapter;
  /** jobs.adapter 에 기록할 어댑터 식별자 (elevenlabs / typecast / manual) */
  ttsAdapterName: string;
}

export interface BuiltShotlist {
  shots: ShotRow[];
  /** 문장 순서대로의 TTS 산출 (오디오 파일 경로 + 실측 ms) */
  tts: TTSOutput[];
}

/**
 * 문장별 TTS 합성(잡 영속) → 실측 길이로 샷리스트 생성 → 일괄 삽입.
 * TTS 는 문장 순서대로 순차 실행한다 — 실패 시 해당 잡이 failed 로 남고 던진다.
 */
export async function buildShotlist(
  deps: BuildShotlistDeps,
  input: BuildShotlistInput,
): Promise<BuiltShotlist> {
  const { dao, runner, tts, ttsAdapterName } = deps;
  if (input.sentences.length === 0) {
    throw new Error("샷리스트 생성 불가: 문장이 없다");
  }

  const outputs: TTSOutput[] = [];
  for (const sentence of input.sentences) {
    const completed = await runner.run(
      {
        episodeId: input.episodeId,
        kind: "tts",
        adapter: ttsAdapterName,
        payload: { text: sentence.narration, voice: input.voice },
      },
      tts,
      () => tts.synthesize({ text: sentence.narration, voice: input.voice }),
    );
    outputs.push(completed.output);
  }

  const shots: NewShot[] = input.sentences.map((sentence, idx) => {
    const isStartEnd = sentence.gen_method === "START_END";
    return {
      id: randomUUID(),
      episode_id: input.episodeId,
      idx,
      narration: sentence.narration,
      // 컷 길이 = 문장별 TTS 파일의 로컬 ffprobe 실측(ms)
      duration_ms: outputs[idx].duration_ms,
      gen_method: sentence.gen_method,
      camera_moves_json: JSON.stringify(sentence.camera_moves),
      image_prompt: sentence.image_prompt,
      motion_prompt: sentence.motion_prompt,
      transition_type: isStartEnd
        ? (sentence.transition_type ?? DEFAULT_START_END_TRANSITION)
        : null,
      fallback_json: JSON.stringify(
        isStartEnd ? (sentence.fallback ?? DEFAULT_START_END_FALLBACK) : [],
      ),
      adopted_asset_id: null,
      adopted_in_ms: null,
      adopted_out_ms: null,
    };
  });

  dao.shots.insertMany(shots);
  return { shots: dao.shots.listByEpisode(input.episodeId), tts: outputs };
}
