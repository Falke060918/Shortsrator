/**
 * Higgsfield 공식 API 클라이언트 — 기준 문서: docs/03-architecture.md ("채택안").
 *
 *   - 베이스: platform.higgsfield.ai
 *   - 인증: `Authorization: Key KEY_ID:SECRET`
 *   - 비동기: submit → request_id → 폴링(기본 2초 간격)
 *
 * 벤더 SDK/HTTP 형상은 이 파일 안에만 존재한다 (코어 로직 유출 금지, 01 문서 §10).
 * 엔드포인트·응답 형상은 1일차 스모크(server/scripts/higgsfield-frames-smoke.ts)로
 * 실측 판정한다 — 미지원(4xx) 거부는 강등 체인의 트리거다 (03-architecture 수용 리스크).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const HIGGSFIELD_BASE_URL = "https://platform.higgsfield.ai";

/** request_id 폴링 간격 — 03-architecture "비동기 request_id → 폴링(2s)" */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

export const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** T2I 모델 2종 (03-architecture) */
export type HiggsfieldImageModel = "soul" | "flux";

/** I2V 모델 (03-architecture) */
export const HIGGSFIELD_I2V_MODEL = "dop";

/**
 * dop 티어 (신 API 표면 /higgsfield-ai/dop/{tier}) —
 * 비용 오름차순 lite(2.0cr) < turbo(6.5cr) < standard(9.0cr), 2026-08-21 /estimate 실측.
 */
export type HiggsfieldDopTier = "lite" | "standard" | "turbo";

/** 엔드포인트 경로 — 스모크로 실측 확인 전까지의 단일 정의처 */
export const HIGGSFIELD_ENDPOINTS = {
  text2image: (model: HiggsfieldImageModel) => `/v1/text2image/${model}`,
  image2video: (model: string) => `/v1/image2video/${model}`,
  text2video: (model: string) => `/v1/text2video/${model}`,
  requestStatus: (requestId: string) => `/v1/requests/${requestId}`,
  /** 신 API 표면 요청 상태 — docs/api-reference의 안정 요청 관리 엔드포인트 */
  requestStatusV2: (requestId: string) => `/requests/${requestId}/status`,
  /** 시작·끝 프레임 영상 생성 — 신 API 표면 (2026-08-21 frames 스모크 실측) */
  dopFirstLastFrame: (tier: HiggsfieldDopTier) =>
    `/higgsfield-ai/dop/${tier}/first-last-frame`,
  /** 프리사인 업로드 URL 발급 — 이미지 입력은 http/https URL만 허용(로컬 경로 422) */
  generateUploadUrl: () => "/files/generate-upload-url",
} as const;

/** 벤더 측 요청 상태 (관측 기반 — 미지의 값은 in_progress로 취급) */
export type HiggsfieldRequestStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "nsfw";

export interface HiggsfieldRequestSnapshot {
  requestId: string;
  status: HiggsfieldRequestStatus;
  /** completed일 때의 산출물 URL 목록 */
  resultUrls: string[];
  /** 벤더가 보고한 소모 크레딧 (노출 안 하면 undefined) */
  credits?: number;
  error?: string;
}

export class HiggsfieldApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "HiggsfieldApiError";
  }

  /**
   * 4xx = 파라미터/기능 미지원 거부로 간주 — start_end 강등 체인
   * (frames → edit_splice → manual)의 강등 트리거.
   */
  get isCapabilityRejection(): boolean {
    return (
      this.statusCode !== undefined &&
      this.statusCode >= 400 &&
      this.statusCode < 500
    );
  }
}

export interface HiggsfieldClientOptions {
  keyId: string;
  secret: string;
  baseUrl?: string;
  /** 테스트 주입용 — 기본 globalThis.fetch */
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  /** 테스트 주입용 대기 함수 */
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 로컬 파일 확장자 → 프리사인 발급용 content_type */
const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export class HiggsfieldClient {
  private readonly keyId: string;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  readonly pollIntervalMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  /** 신 표면 상태 엔드포인트로 확인된 request_id — 이후 폴링은 바로 신 표면으로 간다 */
  private readonly v2StatusIds = new Set<string>();

  constructor(options: HiggsfieldClientOptions) {
    this.keyId = options.keyId;
    this.secret = options.secret;
    this.baseUrl = options.baseUrl ?? HIGGSFIELD_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  /** .env의 HF_API_KEY_ID / HF_API_SECRET로 생성. 없으면 throw. */
  static fromEnv(env: Record<string, string | undefined> = process.env) {
    const keyId = env.HF_API_KEY_ID;
    const secret = env.HF_API_SECRET;
    if (!keyId || !secret) {
      throw new HiggsfieldApiError(
        "HF_API_KEY_ID / HF_API_SECRET 가 .env 에 없다 — API 모드 불가, MANUAL 어댑터를 쓰거나 키를 설정하라",
      );
    }
    return new HiggsfieldClient({ keyId, secret });
  }

  private authHeader(): string {
    return `Key ${this.keyId}:${this.secret}`;
  }

  /** 생성 요청 제출 → 벤더 request_id 반환 */
  async submit(
    endpointPath: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}${endpointPath}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new HiggsfieldApiError(
        `Higgsfield submit 실패 (${endpointPath}): HTTP ${res.status} ${bodyText}`.trim(),
        res.status,
      );
    }
    const body = (await res.json()) as Record<string, unknown>;
    const requestId = body.id ?? body.request_id;
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new HiggsfieldApiError(
        `Higgsfield submit 응답에 request_id 없음 (${endpointPath}): ${JSON.stringify(body)}`,
      );
    }
    return requestId;
  }

  /**
   * request_id 1회 상태 조회 (정규화된 스냅샷 반환).
   * 구 표면 /v1/requests 를 먼저 조회하고, 404/405면 신 표면
   * /requests/{id}/status 로 폴백한다(신 표면 제출분은 구 표면이 405를 반환 —
   * 2026-08-21 실측. 성공한 경로는 request_id별로 기억한다).
   */
  async getRequest(requestId: string): Promise<HiggsfieldRequestSnapshot> {
    const paths = this.v2StatusIds.has(requestId)
      ? [HIGGSFIELD_ENDPOINTS.requestStatusV2(requestId)]
      : [
          HIGGSFIELD_ENDPOINTS.requestStatus(requestId),
          HIGGSFIELD_ENDPOINTS.requestStatusV2(requestId),
        ];
    let lastError: HiggsfieldApiError | undefined;
    for (const endpointPath of paths) {
      const res = await this.fetchFn(`${this.baseUrl}${endpointPath}`, {
        headers: { Authorization: this.authHeader() },
      });
      if (res.ok) {
        if (endpointPath === HIGGSFIELD_ENDPOINTS.requestStatusV2(requestId)) {
          this.v2StatusIds.add(requestId);
        }
        const body = (await res.json()) as Record<string, unknown>;
        return normalizeRequestBody(requestId, body);
      }
      const bodyText = await res.text().catch(() => "");
      lastError = new HiggsfieldApiError(
        `Higgsfield 상태 조회 실패 (${requestId}): HTTP ${res.status} ${bodyText}`.trim(),
        res.status,
      );
      if (res.status !== 404 && res.status !== 405) break; // 404/405만 폴백 트리거
    }
    throw lastError ?? new HiggsfieldApiError(`상태 조회 실패 (${requestId})`);
  }

  /**
   * 로컬 파일을 프리사인 업로드로 벤더 CDN에 올리고 public URL을 반환한다.
   * 형상 실측(2026-08-21): POST /files/generate-upload-url {content_type} →
   * {public_url, upload_url, upload_headers} — PUT은 upload_headers 를 그대로
   * 써야 한다(x-amz-tagging 이 서명에 포함, 누락 시 403 SignatureDoesNotMatch).
   */
  async uploadFile(localPath: string): Promise<string> {
    const ext = path.extname(localPath).replace(".", "").toLowerCase();
    const contentType = UPLOAD_CONTENT_TYPES[ext] ?? "application/octet-stream";
    const res = await this.fetchFn(
      `${this.baseUrl}${HIGGSFIELD_ENDPOINTS.generateUploadUrl()}`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content_type: contentType }),
      },
    );
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new HiggsfieldApiError(
        `업로드 URL 발급 실패 (${localPath}): HTTP ${res.status} ${bodyText}`.trim(),
        res.status,
      );
    }
    const body = (await res.json()) as Record<string, unknown>;
    const publicUrl = body.public_url;
    const uploadUrl = body.upload_url;
    if (typeof publicUrl !== "string" || typeof uploadUrl !== "string") {
      throw new HiggsfieldApiError(
        `업로드 URL 응답 형상 오류: ${JSON.stringify(body)}`,
      );
    }
    const uploadHeaders =
      body.upload_headers && typeof body.upload_headers === "object"
        ? (body.upload_headers as Record<string, string>)
        : { "Content-Type": contentType };
    const data = await readFile(localPath);
    const put = await this.fetchFn(uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: data,
    });
    if (!put.ok) {
      const bodyText = await put.text().catch(() => "");
      throw new HiggsfieldApiError(
        `업로드 PUT 실패 (${localPath}): HTTP ${put.status} ${bodyText}`.trim(),
        put.status,
      );
    }
    return publicUrl;
  }

  /** 완료(completed/failed/nsfw)까지 pollIntervalMs 간격으로 폴링 */
  async waitForCompletion(
    requestId: string,
    options: { timeoutMs?: number } = {},
  ): Promise<HiggsfieldRequestSnapshot> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = await this.getRequest(requestId);
      if (snapshot.status !== "queued" && snapshot.status !== "in_progress") {
        return snapshot;
      }
      if (Date.now() >= deadline) {
        throw new HiggsfieldApiError(
          `Higgsfield 폴링 타임아웃 (${requestId}): ${timeoutMs}ms 초과`,
        );
      }
      await this.sleepFn(this.pollIntervalMs);
    }
  }

  /** 산출물 URL → 로컬 파일 다운로드 (디렉터리 자동 생성) */
  async downloadTo(url: string, destPath: string): Promise<void> {
    const res = await this.fetchFn(url);
    if (!res.ok) {
      throw new HiggsfieldApiError(
        `산출물 다운로드 실패: HTTP ${res.status} ${url}`,
        res.status,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, buffer);
  }
}

/**
 * 벤더 응답 형상 편차를 흡수하는 정규화 —
 * 구 표면 jobs[].results.raw.url / results[].url 과
 * 신 표면 video.url / images[].url / audios[].url (RequestStatus 스키마) 모두 수용.
 */
function normalizeRequestBody(
  requestId: string,
  body: Record<string, unknown>,
): HiggsfieldRequestSnapshot {
  const rawStatus = typeof body.status === "string" ? body.status : "";
  const status = normalizeStatus(rawStatus);

  const resultUrls: string[] = [];
  for (const single of [body.video, body.audio]) {
    if (single && typeof single === "object") {
      const url = (single as Record<string, unknown>).url;
      if (typeof url === "string") resultUrls.push(url);
    }
  }
  for (const list of [body.images, body.audios]) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object") {
          const url = (item as Record<string, unknown>).url;
          if (typeof url === "string") resultUrls.push(url);
        }
      }
    }
  }
  if (Array.isArray(body.jobs)) {
    for (const job of body.jobs) {
      if (job && typeof job === "object") {
        const results = (job as Record<string, unknown>).results;
        if (results && typeof results === "object") {
          const raw = (results as Record<string, unknown>).raw;
          if (raw && typeof raw === "object") {
            const url = (raw as Record<string, unknown>).url;
            if (typeof url === "string") resultUrls.push(url);
          }
        }
      }
    }
  }
  if (Array.isArray(body.results)) {
    for (const result of body.results) {
      if (result && typeof result === "object") {
        const url = (result as Record<string, unknown>).url;
        if (typeof url === "string") resultUrls.push(url);
      }
    }
  }

  return {
    requestId,
    status,
    resultUrls,
    credits: typeof body.credits === "number" ? body.credits : undefined,
    error: typeof body.error === "string" ? body.error : undefined,
  };
}

function normalizeStatus(raw: string): HiggsfieldRequestStatus {
  switch (raw) {
    case "queued":
      return "queued";
    case "completed":
      return "completed";
    case "failed":
    case "canceled": // 신 표면 종결 상태 — 실패로 취급(무한 폴링 방지)
      return "failed";
    case "nsfw":
      return "nsfw";
    default:
      // in_progress / processing / 미지의 중간 상태는 진행 중으로 취급
      return "in_progress";
  }
}
