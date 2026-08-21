/** routes 층 공용 컨텍스트 — app.ts가 조립해서 주입한다. */
import type { Dao } from "../db/index.js";
import type { PipelineService } from "./pipeline-service.js";

export interface RouteContext {
  dao: Dao;
  pipeline: PipelineService;
  /** workspace 루트(절대 경로) — /media 정적 서빙·MANUAL 드롭 저장 위치 */
  workspaceDir: string;
  /** API 키 기록 대상 .env 파일(절대 경로) — PUT /api/settings/keys가 쓴다 */
  envFilePath: string;
}
