/**
 * Claude LLM 어댑터 — shared LLMAdapter 구현 (REQ-SCRIPT-01: 대본·샷리스트 생성).
 * schema 가 주어지면 Anthropic 강제 tool_choice 로 JSON 스키마 출력을 강제한다 —
 * output.text 는 스키마를 만족하는 JSON 문자열이 된다.
 * 벤더 SDK/HTTP 는 이 파일 안에만 존재한다 (코어 로직 유출 금지 — shared/adapters.ts).
 */

import type {
  JobHandle,
  JobSnapshot,
  LLMAdapter,
  LLMGenerateInput,
  LLMOutput,
} from "@shortsrator/shared";
import { LocalJobStore } from "../local-job-store.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 4096;

/** 구조화 출력을 강제할 때 쓰는 도구 이름 — 응답의 tool_use 블록에서 이 이름을 찾는다 */
const STRUCTURED_TOOL_NAME = "emit_structured_output";

/** 비용 추정 상수(편당 비용 추적용 대략치) — Sonnet USD/1M tokens, 환율은 고정 근사 */
const USD_PER_M_INPUT = 3;
const USD_PER_M_OUTPUT = 15;
const KRW_PER_USD = 1400;

export interface ClaudeAdapterOptions {
  /** 기본값: process.env.ANTHROPIC_API_KEY */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** 테스트 HTTP 목 주입용 */
  fetchImpl?: typeof fetch;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class ClaudeLLMAdapter implements LLMAdapter {
  readonly mode = "api" as const;

  private readonly jobs = new LocalJobStore<LLMOutput>();
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(input: LLMGenerateInput): Promise<JobHandle> {
    if (!this.apiKey) {
      return this.jobs.failImmediately(
        "ANTHROPIC_API_KEY 가 설정되지 않았다 (.env 확인 — docs/03-architecture.md 실행법)",
      );
    }
    const apiKey = this.apiKey;
    return this.jobs.run(async () => {
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: "user", content: input.prompt }],
      };
      if (input.schema) {
        // 강제 tool_choice — 모델이 스키마를 만족하는 JSON 만 낼 수 있게 한다.
        body.tools = [
          {
            name: STRUCTURED_TOOL_NAME,
            description:
              "요청받은 결과를 이 도구의 입력 스키마에 맞는 JSON 으로 출력한다.",
            input_schema: input.schema,
          },
        ];
        body.tool_choice = { type: "tool", name: STRUCTURED_TOOL_NAME };
      }

      const res = await this.fetchImpl(API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`Claude API ${res.status}: ${detail}`);
      }

      const message = (await res.json()) as AnthropicMessageResponse;
      const text = input.schema
        ? extractStructuredJson(message)
        : extractText(message);

      return { output: { text }, cost: estimateCost(message) };
    });
  }

  async poll(handle: JobHandle): Promise<JobSnapshot<LLMOutput>> {
    return this.jobs.snapshot(handle);
  }
}

function extractStructuredJson(message: AnthropicMessageResponse): string {
  const block = message.content.find(
    (b) => b.type === "tool_use" && b.name === STRUCTURED_TOOL_NAME,
  );
  if (!block || block.input === undefined) {
    throw new Error("Claude 응답에 구조화 출력(tool_use)이 없다");
  }
  return JSON.stringify(block.input);
}

function extractText(message: AnthropicMessageResponse): string {
  const text = message.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (!text) {
    throw new Error("Claude 응답에 텍스트가 없다");
  }
  return text;
}

function estimateCost(message: AnthropicMessageResponse) {
  const inTokens = message.usage?.input_tokens ?? 0;
  const outTokens = message.usage?.output_tokens ?? 0;
  const usd =
    (inTokens * USD_PER_M_INPUT + outTokens * USD_PER_M_OUTPUT) / 1_000_000;
  return { krw: Math.round(usd * KRW_PER_USD) };
}
