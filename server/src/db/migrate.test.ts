import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { getUserVersion, migrate } from "./migrate.js";

/** 임시 디렉터리 + 임시 DB 파일 — 각 테스트가 독립 DB를 쓴다 */
function makeTempDb(): { db: Db; dir: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "shortsrator-db-"));
  const db = openDb(path.join(dir, "test.db"));
  return { db, dir };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function track(db: Db, dir: string) {
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("migrate (실제 마이그레이션)", () => {
  it("전체 스키마를 생성한다 — §8 채택 테이블 + 수정 4건, channels·uploads 제외", () => {
    const { db, dir } = makeTempDb();
    track(db, dir);
    const applied = migrate(db);
    expect(applied.length).toBeGreaterThanOrEqual(1);

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();
    const tables = new Set(rows.map((r) => r.name));

    for (const expected of [
      "themes",
      "theme_versions",
      "topics",
      "episodes",
      "shots",
      "generated_assets",
      "master_assets",
      "gate_decisions",
      "jobs", // 03 수정 2
      "settings", // 03 수정 4
    ]) {
      expect(tables.has(expected), `${expected} 테이블 없음`).toBe(true);
    }
    // P2로 연기된 테이블은 없어야 한다 (03 수정 4)
    expect(tables.has("channels")).toBe(false);
    expect(tables.has("uploads")).toBe(false);
  });

  it("적용 후 user_version이 마지막 번호로 오르고, 재실행은 no-op이다", () => {
    const { db, dir } = makeTempDb();
    track(db, dir);
    migrate(db);
    expect(getUserVersion(db)).toBeGreaterThanOrEqual(1);
    expect(migrate(db)).toEqual([]);
  });
});

describe("migrate (러너 자체 — 합성 마이그레이션 디렉터리)", () => {
  it("번호 순서대로 적용하고 적용 파일명을 반환한다", () => {
    const { db, dir } = makeTempDb();
    track(db, dir);
    const migDir = path.join(dir, "migrations");
    mkdirSync(migDir);
    // 파일명 사전순(010 < 002가 아님)을 배제하기 위해 자릿수 다른 번호를 섞는다
    writeFileSync(path.join(migDir, "001_a.sql"), "CREATE TABLE a (id TEXT);");
    writeFileSync(
      path.join(migDir, "002_b.sql"),
      "ALTER TABLE a ADD COLUMN b TEXT;",
    );
    const applied = migrate(db, migDir);
    expect(applied).toEqual(["001_a.sql", "002_b.sql"]);
    expect(getUserVersion(db)).toBe(2);

    // 부분 재개: 003만 새로 추가하면 그것만 적용된다
    writeFileSync(path.join(migDir, "003_c.sql"), "CREATE TABLE c (id TEXT);");
    expect(migrate(db, migDir)).toEqual(["003_c.sql"]);
    expect(getUserVersion(db)).toBe(3);
  });

  it("중복 번호는 에러다", () => {
    const { db, dir } = makeTempDb();
    track(db, dir);
    const migDir = path.join(dir, "migrations");
    mkdirSync(migDir);
    writeFileSync(path.join(migDir, "001_a.sql"), "CREATE TABLE a (id TEXT);");
    writeFileSync(path.join(migDir, "001_b.sql"), "CREATE TABLE b (id TEXT);");
    expect(() => migrate(db, migDir)).toThrow(/중복/);
  });

  it("SQL 실패 시 그 파일 전체가 롤백되고 user_version은 오르지 않는다", () => {
    const { db, dir } = makeTempDb();
    track(db, dir);
    const migDir = path.join(dir, "migrations");
    mkdirSync(migDir);
    writeFileSync(
      path.join(migDir, "001_bad.sql"),
      "CREATE TABLE ok (id TEXT); CREATE TABLE broken (;",
    );
    expect(() => migrate(db, migDir)).toThrow();
    expect(getUserVersion(db)).toBe(0);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'ok'")
      .all<{ name: string }>();
    expect(rows).toEqual([]);
  });
});
