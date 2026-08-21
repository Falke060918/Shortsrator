import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUDGET_SETTING_KEY,
  DEFAULT_BUDGET_KRW,
  aggregateEpisodeCost,
  budgetKrw,
  persistEpisodeCost,
} from "./cost.js";
import { openTestDb, seedEpisode, type TestDb } from "./test-fixtures.js";

let t: TestDb;
let episodeId: string;

beforeEach(() => {
  t = openTestDb();
  episodeId = seedEpisode(t.dao).episodeId;
});

afterEach(() => {
  t.close();
});

function insertJobWithCost(credits: number | null, krw: number | null): void {
  t.dao.jobs.insert({
    id: randomUUID(),
    episode_id: episodeId,
    shot_id: null,
    kind: "video_i2v",
    adapter: "higgsfield",
    status: "succeeded",
    request_id: null,
    cost_credits: credits,
    cost_krw: krw,
    payload_json: null,
    error: null,
  });
}

describe("aggregateEpisodeCost — jobs.cost_* 합산", () => {
  it("잡이 없으면 0원, 예산 이내", () => {
    const cost = aggregateEpisodeCost(t.dao, episodeId);
    expect(cost).toMatchObject({
      credits: 0,
      krw: 0,
      budgetKrw: DEFAULT_BUDGET_KRW,
      overBudget: false,
    });
    expect(cost.warning).toBeUndefined();
  });

  it("null 비용은 0으로 취급하며 합산한다", () => {
    insertJobWithCost(10, 1400);
    insertJobWithCost(null, null);
    insertJobWithCost(5, 700);
    const cost = aggregateEpisodeCost(t.dao, episodeId);
    expect(cost.credits).toBe(15);
    expect(cost.krw).toBe(2100);
    expect(cost.overBudget).toBe(false);
  });

  it("예산 초과 시 경고 문자열이 붙는다", () => {
    insertJobWithCost(40, 5600);
    const cost = aggregateEpisodeCost(t.dao, episodeId);
    expect(cost.overBudget).toBe(true);
    expect(cost.warning).toContain("편당 예산 초과");
  });

  it("설정된 예산 한도를 쓴다 (settings KV)", () => {
    t.dao.settings.set(BUDGET_SETTING_KEY, "3000");
    insertJobWithCost(null, 3500);
    const cost = aggregateEpisodeCost(t.dao, episodeId);
    expect(cost.budgetKrw).toBe(3000);
    expect(cost.overBudget).toBe(true);
  });

  it("깨진 예산 설정은 기본값으로 폴백", () => {
    t.dao.settings.set(BUDGET_SETTING_KEY, "예산없음");
    expect(budgetKrw(t.dao)).toBe(DEFAULT_BUDGET_KRW);
    t.dao.settings.set(BUDGET_SETTING_KEY, "-100");
    expect(budgetKrw(t.dao)).toBe(DEFAULT_BUDGET_KRW);
  });
});

describe("persistEpisodeCost", () => {
  it("집계 결과가 episodes.cost_json 에 반영된다", () => {
    insertJobWithCost(12, 1700);
    const cost = persistEpisodeCost(t.dao, episodeId);
    const row = t.dao.episodes.get(episodeId);
    expect(JSON.parse(row?.cost_json ?? "")).toEqual(cost);
    expect(cost.krw).toBe(1700);
  });
});
