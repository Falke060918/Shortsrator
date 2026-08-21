/**
 * DB 접근 단일 래퍼 — node:sqlite(DatabaseSync)를 이 파일 안에만 격리한다.
 * node:sqlite RC 리스크 대응: better-sqlite3 교체가 필요해지면 이 파일 1개만
 * 수정한다 (docs/03-architecture.md 채택안). 다른 모듈은 Db/DbStatement
 * 인터페이스에만 의존해야 하며, node:sqlite를 직접 import하면 안 된다.
 */
import { DatabaseSync } from "node:sqlite";

/** SQLite에 바인딩 가능한 값 */
export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqlRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface DbStatement {
  run(...params: SqlValue[]): SqlRunResult;
  get<T = Record<string, SqlValue>>(...params: SqlValue[]): T | undefined;
  all<T = Record<string, SqlValue>>(...params: SqlValue[]): T[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): DbStatement;
  /** BEGIN…COMMIT 래핑 — 콜백이 던지면 ROLLBACK 후 재던짐 */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/**
 * DB 파일을 열고 래퍼를 반환한다. `:memory:`도 허용.
 * 산출물은 파일이 원천이고 DB는 메타만 담는다 — 로컬 1인 앱이므로 WAL로 충분.
 */
export function openDb(filePath: string): Db {
  const raw = new DatabaseSync(filePath);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");

  return {
    exec(sql) {
      raw.exec(sql);
    },
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run: (...params) => stmt.run(...params),
        get: <T>(...params: SqlValue[]) => stmt.get(...params) as T | undefined,
        all: <T>(...params: SqlValue[]) => stmt.all(...params) as T[],
      };
    },
    transaction(fn) {
      raw.exec("BEGIN");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    close() {
      raw.close();
    },
  };
}
