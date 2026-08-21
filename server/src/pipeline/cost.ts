/**
 * 편당 비용 집계 (01 문서 §10) — jobs.cost_credits/cost_krw 합산이 원천.
 * 예산 한도는 settings KV(budget_krw_per_episode) — 기준 3,000~5,000원
 * (03-architecture "수용한 리스크": 초과 추산이므로 경고를 P1 포함).
 */

import type { Dao } from "../db/dao.js";

/** settings KV 키 — 편당 예산 한도(원) */
export const BUDGET_SETTING_KEY = "budget_krw_per_episode";

/** 설정이 없을 때의 기본 예산(원) — 목표 상한 5,000원 */
export const DEFAULT_BUDGET_KRW = 5000;

export interface EpisodeCost {
  credits: number;
  krw: number;
  budgetKrw: number;
  overBudget: boolean;
  /** overBudget 일 때만 존재 */
  warning?: string;
}

/** 설정에서 예산 한도를 읽는다 — 없거나 파싱 불가면 기본값 */
export function budgetKrw(dao: Dao): number {
  const raw = dao.settings.get(BUDGET_SETTING_KEY);
  if (raw === undefined) return DEFAULT_BUDGET_KRW;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_KRW;
}

/** 에피소드의 모든 잡 비용을 합산하고 예산 초과 여부를 판정한다 */
export function aggregateEpisodeCost(dao: Dao, episodeId: string): EpisodeCost {
  let credits = 0;
  let krw = 0;
  for (const job of dao.jobs.listByEpisode(episodeId)) {
    credits += job.cost_credits ?? 0;
    krw += job.cost_krw ?? 0;
  }
  const budget = budgetKrw(dao);
  const overBudget = krw > budget;
  const cost: EpisodeCost = { credits, krw, budgetKrw: budget, overBudget };
  if (overBudget) {
    cost.warning = `편당 예산 초과: ${krw.toLocaleString("ko-KR")}원 / 한도 ${budget.toLocaleString("ko-KR")}원`;
  }
  return cost;
}

/** 집계 결과를 episodes.cost_json 에 반영하고 반환한다 */
export function persistEpisodeCost(dao: Dao, episodeId: string): EpisodeCost {
  const cost = aggregateEpisodeCost(dao, episodeId);
  dao.episodes.updateCost(episodeId, JSON.stringify(cost));
  return cost;
}
