/**
 * PipelineService — routes 층이 의존하는 얇은 파이프라인 인터페이스.
 *
 * pipeline-engine(#8)이 병렬 개발 중이라 여기서 계약만 정의하고 주입식으로 쓴다.
 * 실배선(server/src/pipeline 구현체 연결)은 #10 pilot-integration 소관이며,
 * 그 전까지 기본 주입은 NotWiredPipeline(503)이다.
 */
import type {
  AdoptRequest,
  AdvanceResponse,
  EpisodeState,
  GateRequest,
  ServerEvent,
} from "@shortsrator/shared";

export interface PipelineService {
  /** 다음 자동 단계 실행(잡 투입) — POST /api/episodes/:id/advance */
  advance(episodeId: string): Promise<AdvanceResponse>;
  /** GATE1~4 승인/반려 — POST /api/episodes/:id/gate */
  decideGate(
    episodeId: string,
    request: GateRequest,
  ): Promise<{ state: EpisodeState }>;
  /** GATE3 클립 채택 — POST /api/shots/:id/adopt */
  adoptClip(shotId: string, request: AdoptRequest): Promise<void>;
  /** POST /api/episodes/:id/rollback */
  rollback(
    episodeId: string,
    toState: EpisodeState,
  ): Promise<{ state: EpisodeState }>;
  /** MANUAL 드롭 파일 도착 통지 — POST /api/manual/:jobId/files */
  onManualFiles(jobId: string, filePaths: string[]): Promise<void>;
  /**
   * 에피소드 이벤트 구독(SSE 채널의 원천). 해제 함수를 반환한다.
   * 잡 진행·상태 전이를 ServerEvent로 밀어준다.
   */
  subscribe(
    episodeId: string,
    listener: (event: ServerEvent) => void,
  ): () => void;
}

/** 파이프라인 미배선 상태에서 조작 엔드포인트가 던지는 에러 — 503으로 매핑된다. */
export class PipelineNotWiredError extends Error {
  constructor() {
    super("pipeline 미배선 — #10 pilot-integration에서 실구현이 주입된다");
    this.name = "PipelineNotWiredError";
  }
}

/** 기본 주입체: 파이프라인 없이도 서버는 부팅되고, 조작 요청만 503을 받는다. */
export function createNotWiredPipeline(): PipelineService {
  const notWired = (): never => {
    throw new PipelineNotWiredError();
  };
  return {
    advance: async () => notWired(),
    decideGate: async () => notWired(),
    adoptClip: async () => notWired(),
    rollback: async () => notWired(),
    onManualFiles: async () => notWired(),
    // 구독은 no-op — SSE는 초기 상태 이벤트만 나간다.
    subscribe: () => () => {},
  };
}
