/**
 * MANUAL 어댑터 4종 (LLM/TTS/Image/Video) — REQ-ADAPT-01 "모든 어댑터 필수".
 * 지시서(복붙 프롬프트 + 레퍼런스 + 확장자 화이트리스트)를 만들고,
 * 드롭 파일로 succeeded 전이한다. 공통 골격은 manual-base.ts.
 *
 * 확장자 화이트리스트: 이미지 png/jpg/webp, 영상 mp4/mov (03-architecture 보안 경계).
 * LLM(txt/md/json)·TTS(mp3/wav)는 그 목록 밖 — api-server의 multipart 화이트리스트
 * 확장이 필요하다 (구현 시 보고됨).
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type {
  I2VInput,
  ImageAdapter,
  ImageGenerateInput,
  ImageOutput,
  JobHandle,
  LLMAdapter,
  LLMGenerateInput,
  LLMOutput,
  StartEndInput,
  T2VInput,
  TTSAdapter,
  TTSOutput,
  TTSSynthesizeInput,
  VideoAdapter,
  VideoOutput,
} from "@shortsrator/shared";
import { ManualAdapterBase } from "./manual-base.js";

// ---------------------------------------------------------------- LLM

export class ManualLLMAdapter
  extends ManualAdapterBase<LLMOutput>
  implements LLMAdapter
{
  async generate(input: LLMGenerateInput): Promise<JobHandle> {
    const schemaNote = input.schema
      ? `\n출력은 아래 JSON 스키마를 따라야 한다:\n${JSON.stringify(input.schema, null, 2)}`
      : "";
    return this.createJob({
      title: "LLM 수동 생성",
      body: `아래 프롬프트를 외부 LLM(웹 Claude/ChatGPT 등)에 붙여넣고, 결과 텍스트를 파일로 저장해 드롭 존에 넣어라.${schemaNote}`,
      prompts: [input.prompt],
      referenceFilePaths: [],
      expectedFileExtensions: ["txt", "md", "json"],
    });
  }

  protected async buildOutput(filePaths: string[]): Promise<LLMOutput> {
    const text = await readFile(filePaths[0], "utf-8");
    return { text };
  }
}

// ---------------------------------------------------------------- TTS

/** 로컬 ffprobe 실측(ms) — 벤더 중립 컷 길이 원천 (03-architecture) */
export async function ffprobeDurationMs(filePath: string): Promise<number> {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    const proc = spawn("ffprobe", args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe 실패 (exit ${code}): ${err.trim()}`));
    });
  });
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe 길이 파싱 실패: "${stdout.trim()}"`);
  }
  return Math.round(seconds * 1000);
}

export interface ManualTTSAdapterOptions {
  /** 테스트 주입용 — 기본 ffprobe 실측 */
  probeDurationMs?: (filePath: string) => Promise<number>;
}

export class ManualTTSAdapter
  extends ManualAdapterBase<TTSOutput>
  implements TTSAdapter
{
  private readonly probeDurationMs: (filePath: string) => Promise<number>;

  constructor(options: ManualTTSAdapterOptions = {}) {
    super();
    this.probeDurationMs = options.probeDurationMs ?? ffprobeDurationMs;
  }

  async synthesize(input: TTSSynthesizeInput): Promise<JobHandle> {
    return this.createJob({
      title: "TTS 수동 합성",
      body: `아래 문장을 외부 TTS 툴에서 보이스 "${input.voice}"로 합성하고, 오디오 파일을 드롭 존에 넣어라. 문장 1개 = 파일 1개 — 파일 길이가 곧 컷 길이다.`,
      prompts: [input.text],
      referenceFilePaths: [],
      expectedFileExtensions: ["mp3", "wav"],
    });
  }

  protected async buildOutput(filePaths: string[]): Promise<TTSOutput> {
    const audioFilePath = filePaths[0];
    return {
      audioFilePath,
      duration_ms: await this.probeDurationMs(audioFilePath),
    };
  }
}

// ---------------------------------------------------------------- Image

export class ManualImageAdapter
  extends ManualAdapterBase<ImageOutput>
  implements ImageAdapter
{
  async generate(input: ImageGenerateInput): Promise<JobHandle> {
    const count = input.count ?? 2;
    return this.createJob({
      title: "프레임 이미지 수동 생성",
      body: `아래 프롬프트로 외부 이미지 툴에서 ${input.aspect} 비율 후보 ${count}장을 생성해 드롭 존에 넣어라. 레퍼런스 파일이 있으면 반드시 함께 입력하라.`,
      prompts: [input.prompt],
      referenceFilePaths: input.referenceImagePaths,
      expectedFileExtensions: ["png", "jpg", "jpeg", "webp"],
    });
  }

  protected async buildOutput(filePaths: string[]): Promise<ImageOutput> {
    return { imageFilePaths: filePaths };
  }
}

// ---------------------------------------------------------------- Video

export class ManualVideoAdapter
  extends ManualAdapterBase<VideoOutput>
  implements VideoAdapter
{
  async i2v(input: I2VInput): Promise<JobHandle> {
    return this.createJob({
      title: "I2V 클립 수동 생성",
      body: `시작 이미지를 외부 영상 툴에 넣고 아래 motion 프롬프트로 약 ${formatSec(input.duration_ms)}초 클립을 생성해 드롭 존에 넣어라.`,
      prompts: [input.motionPrompt],
      referenceFilePaths: [input.imagePath],
      expectedFileExtensions: ["mp4", "mov"],
    });
  }

  async startEnd(input: StartEndInput): Promise<JobHandle> {
    return this.createJob({
      title: "시작-끝 프레임 클립 수동 생성",
      body: `시작/끝 프레임 2장을 외부 영상 툴(first/last frame 지원 모델)에 넣고 아래 motion 프롬프트로 약 ${formatSec(input.duration_ms)}초 클립을 생성해 드롭 존에 넣어라.`,
      prompts: [input.motionPrompt],
      referenceFilePaths: [input.startFramePath, input.endFramePath],
      expectedFileExtensions: ["mp4", "mov"],
    });
  }

  async t2v(input: T2VInput): Promise<JobHandle> {
    return this.createJob({
      title: "T2V B-roll 수동 생성",
      body: `아래 프롬프트로 외부 영상 툴에서 약 ${formatSec(input.duration_ms)}초 B-roll 클립을 생성해 드롭 존에 넣어라.`,
      prompts: [input.prompt],
      referenceFilePaths: [],
      expectedFileExtensions: ["mp4", "mov"],
    });
  }

  protected async buildOutput(filePaths: string[]): Promise<VideoOutput> {
    return { clipFilePaths: filePaths };
  }
}

function formatSec(duration_ms: number): string {
  return (duration_ms / 1000).toFixed(1);
}
