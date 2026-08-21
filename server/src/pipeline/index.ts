/**
 * pipeline-engine 공개 표면 (issue #8) — api-server(#9)·pilot-integration(#10)은
 * 이 배럴로만 파이프라인을 호출한다.
 */

export {
  InvalidTransitionError,
  assertForwardStep,
  assertRollbackTarget,
  isGateState,
  nextState,
  stateIndex,
} from "./state-machine.js";
export {
  GATE_AUTO_APPROVE_SETTING,
  GateNotApprovedError,
  GateStateMismatchError,
  UNSKIPPABLE_GATES,
  isAutoApprovable,
  parseAutoApproveGates,
  rejectTargetOf,
} from "./gates.js";
export {
  JobFailedError,
  JobRunner,
  RESUMABLE_STATUSES,
  type AdapterResolver,
  type CompletedJob,
  type JobRunnerOptions,
  type JobSpec,
  type ResumeResult,
} from "./job-runner.js";
export {
  EpisodeNotFoundError,
  PipelineEngine,
  type GateDecisionInput,
} from "./engine.js";
export {
  DEFAULT_START_END_FALLBACK,
  DEFAULT_START_END_TRANSITION,
  buildShotlist,
  type BuildShotlistDeps,
  type BuildShotlistInput,
  type BuiltShotlist,
  type SentencePlan,
} from "./shotlist.js";
export {
  chainOf,
  runStartEndShot,
  type StartEndDeps,
  type StartEndResult,
} from "./start-end.js";
export {
  BUDGET_SETTING_KEY,
  DEFAULT_BUDGET_KRW,
  aggregateEpisodeCost,
  budgetKrw,
  persistEpisodeCost,
  type EpisodeCost,
} from "./cost.js";
