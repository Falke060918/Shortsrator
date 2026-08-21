/**
 * wiring 공개 표면 (issue #10) — app.ts 부팅 배선은 여기서만 import 한다.
 * 상태 전이는 pipeline 배럴(PipelineEngine)만 경유한다 — 게이트 불가침 유지.
 */
export { ensureThemePresets, themeVersionIdOf } from "./presets.js";
export { AdapterSet, NO_API_VIDEO, type ManualDropTarget } from "./adapter-set.js";
export {
  StageBusyError,
  createWiredPipeline,
  parseScriptSentences,
  type WiredPipeline,
  type WiredPipelineOptions,
} from "./wired-pipeline.js";
