/**
 * 모델 어댑터 인터페이스 4종 (LLM/TTS/Image/Video) — 기준 문서:
 * docs/03-architecture.md ("되돌리기 어려운 결정" 2), docs/01_솔루션_개발명세.md §6.
 *
 * 공통 비동기 잡 시맨틱스:
 *   submit 계열 메서드(generate/synthesize/i2v/…)는 즉시 JobHandle을 반환하고,
 *   호출자는 poll(handle)로 진행 상태를 조회한다 (Higgsfield request_id → 2s 폴링 등).
 *   완료 스냅샷에는 비용 메타(cost)가 실린다 — 편당 비용 추적(§10)의 원천.
 *
 * MANUAL 모드 시맨틱스 (REQ-ADAPT-01, 모든 어댑터 필수):
 *   submit이 즉시 manual_pending 잡을 만들고 스냅샷에 복붙 가능한 제작 지시서
 *   (instructions)를 노출한다. 사용자가 외부 툴 산출물을 드롭 존에 넣으면
 *   (POST /api/manual/:jobId/files) 잡이 succeeded로 전이하고 파이프라인이 이어진다.
 *   벤더 SDK는 어댑터 구현 안에만 존재해야 한다 — 코어 로직 유출 금지.
 */

export type AdapterMode = "api" | "manual";

export type JobStatus =
  | "queued"
  | "running"
  | "manual_pending"
  | "succeeded"
  | "failed";

/** 생성 호출 1건의 비용 메타 — 크레딧과 원화 추정 병기 */
export interface CostMeta {
  credits?: number;
  krw?: number;
}

export interface JobHandle {
  /** jobs 테이블의 로컬 잡 ID */
  jobId: string;
  /** 벤더 측 비동기 요청 ID (예: Higgsfield request_id) */
  requestId?: string;
}

/** MANUAL 모드에서 화면에 출력할 제작 지시서 */
export interface ManualInstructions {
  title: string;
  /** 수행 절차 설명 */
  body: string;
  /** 외부 툴에 복붙할 프롬프트 목록 */
  prompts: string[];
  /** 함께 쓸 레퍼런스 파일 경로 목록 */
  referenceFilePaths: string[];
  /** 드롭 존에서 받을 파일 확장자 화이트리스트 (png/jpg/webp/mp4/mov) */
  expectedFileExtensions: string[];
}

export interface JobSnapshot<TOutput> {
  status: JobStatus;
  /** succeeded일 때만 존재 */
  output?: TOutput;
  /** 완료(succeeded/failed) 시 반환되는 비용 메타 */
  cost?: CostMeta;
  /** failed일 때의 사유 */
  error?: string;
  /** manual_pending일 때의 제작 지시서 */
  instructions?: ManualInstructions;
}

/** 어댑터 공통 계약 — submit 계열은 각 어댑터 인터페이스가 정의한다 */
export interface AsyncJobAdapter<TOutput> {
  readonly mode: AdapterMode;
  poll(handle: JobHandle): Promise<JobSnapshot<TOutput>>;
  cancel?(handle: JobHandle): Promise<void>;
}

// ---------------------------------------------------------------- LLM

export interface LLMGenerateInput {
  prompt: string;
  /** 구조화 출력을 강제할 JSON 스키마(선택) */
  schema?: Record<string, unknown>;
}

export interface LLMOutput {
  text: string;
}

export interface LLMAdapter extends AsyncJobAdapter<LLMOutput> {
  generate(input: LLMGenerateInput): Promise<JobHandle>;
}

// ---------------------------------------------------------------- TTS

export interface TTSSynthesizeInput {
  /** 문장 단위로 호출한다 — 문장별 파일 길이가 곧 컷 길이 */
  text: string;
  /** 테마 voice_config의 보이스 ID */
  voice: string;
}

export interface TTSOutput {
  audioFilePath: string;
  /** 로컬 ffprobe 실측(ms) — 벤더 API 응답값이 아니다 (벤더 중립) */
  duration_ms: number;
}

export interface TTSAdapter extends AsyncJobAdapter<TTSOutput> {
  synthesize(input: TTSSynthesizeInput): Promise<JobHandle>;
}

// ---------------------------------------------------------------- Image

export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface ImageGenerateInput {
  prompt: string;
  /** 마스터 애셋 등 레퍼런스 이미지 경로 (API 미지원 시 어댑터가 지시서에 명시) */
  referenceImagePaths: string[];
  aspect: AspectRatio;
  /** 후보 장수 (샷당 2~4장) */
  count?: number;
}

export interface ImageOutput {
  imageFilePaths: string[];
}

export interface ImageAdapter extends AsyncJobAdapter<ImageOutput> {
  generate(input: ImageGenerateInput): Promise<JobHandle>;
}

// ---------------------------------------------------------------- Video

export interface I2VInput {
  imagePath: string;
  motionPrompt: string;
  duration_ms: number;
}

export interface StartEndInput {
  startFramePath: string;
  endFramePath: string;
  motionPrompt: string;
  duration_ms: number;
}

/** B-roll 전용 */
export interface T2VInput {
  prompt: string;
  duration_ms: number;
}

export interface VideoOutput {
  clipFilePaths: string[];
}

export interface VideoAdapter extends AsyncJobAdapter<VideoOutput> {
  i2v(input: I2VInput): Promise<JobHandle>;
  startEnd(input: StartEndInput): Promise<JobHandle>;
  t2v(input: T2VInput): Promise<JobHandle>;
}
