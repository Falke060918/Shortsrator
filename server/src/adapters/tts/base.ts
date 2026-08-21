/**
 * TTS 어댑터 공통 골격 — shared TTSAdapter 구현 (REQ-TTS-01: 문장 단위 합성).
 * 벤더 차이는 HTTP 요청 1건(makeRequest)뿐이다: 오디오 바이너리를 받아 파일로 쓰고,
 * duration_ms 는 벤더 응답이 아니라 로컬 ffprobe 실측으로 얻는다 (벤더 중립 —
 * docs/03-architecture.md 채택안).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  JobHandle,
  JobSnapshot,
  TTSAdapter,
  TTSOutput,
  TTSSynthesizeInput,
} from "@shortsrator/shared";
import { probeDurationMs } from "../ffprobe.js";
import { LocalJobStore } from "../local-job-store.js";

export interface TTSAdapterOptions {
  /** 기본값: 벤더별 환경변수 (ELEVENLABS_API_KEY / TYPECAST_API_KEY) */
  apiKey?: string;
  /**
   * 오디오 파일을 쓸 디렉터리 — 파이프라인이 에피소드별 tts 경로
   * (workspace/{channel}/{themeVersion}/{episode}/tts/)를 넘긴다.
   */
  outputDir?: string;
  /** 벤더 모델 ID 재정의 */
  modelId?: string;
  /** 테스트 HTTP 목 주입용 */
  fetchImpl?: typeof fetch;
  /** 테스트용 실측 함수 주입 — 기본은 로컬 ffprobe */
  probeDurationMs?: (filePath: string) => Promise<number>;
}

/** 벤더별로 채우는 요청 명세 — 응답 본문은 오디오 바이너리여야 한다 */
export interface TTSVendorRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** 저장 파일 확장자 (mp3/wav) */
  fileExtension: string;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "workspace", "tts");

export abstract class HttpTTSAdapter implements TTSAdapter {
  readonly mode = "api" as const;

  protected readonly jobs = new LocalJobStore<TTSOutput>();
  protected readonly apiKey: string | undefined;
  protected readonly outputDir: string;
  protected readonly modelId: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly probe: (filePath: string) => Promise<number>;

  /** 키 미설정 오류 메시지에 쓸 환경변수 이름 */
  protected abstract readonly apiKeyEnvName: string;

  constructor(envApiKey: string | undefined, options: TTSAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? envApiKey;
    this.outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
    this.modelId = options.modelId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probe = options.probeDurationMs ?? probeDurationMs;
  }

  protected abstract makeRequest(
    input: TTSSynthesizeInput,
    apiKey: string,
  ): TTSVendorRequest;

  async synthesize(input: TTSSynthesizeInput): Promise<JobHandle> {
    if (!this.apiKey) {
      return this.jobs.failImmediately(
        `${this.apiKeyEnvName} 가 설정되지 않았다 (.env 확인 — docs/03-architecture.md 실행법)`,
      );
    }
    const request = this.makeRequest(input, this.apiKey);
    return this.jobs.run(async (jobId) => {
      const res = await this.fetchImpl(request.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...request.headers },
        body: JSON.stringify(request.body),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`${this.constructor.name} ${res.status}: ${detail}`);
      }

      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.byteLength === 0) {
        throw new Error(`${this.constructor.name}: 빈 오디오 응답을 받았다`);
      }
      await mkdir(this.outputDir, { recursive: true });
      const audioFilePath = path.join(
        this.outputDir,
        `${jobId}.${request.fileExtension}`,
      );
      await writeFile(audioFilePath, audio);

      // 컷 길이의 원천 — 로컬 ffprobe 실측(ms 정수)
      const duration_ms = await this.probe(audioFilePath);
      return { output: { audioFilePath, duration_ms } };
    });
  }

  async poll(handle: JobHandle): Promise<JobSnapshot<TTSOutput>> {
    return this.jobs.snapshot(handle);
  }
}
