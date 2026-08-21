/**
 * 번호제 SQL 마이그레이션 러너 (경량, ORM 없음 — docs/03-architecture.md).
 * migrations/ 아래 `NNN_이름.sql`을 번호 오름차순으로 적용하고,
 * 적용 지점은 SQLite `PRAGMA user_version`(마지막으로 적용한 번호)으로 기록한다.
 * 파일 1개 = 트랜잭션 1개 — 중간 실패 시 그 파일 전체가 롤백된다.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";

const DEFAULT_MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

interface MigrationFile {
  no: number;
  name: string;
  filePath: string;
}

function listMigrationFiles(dir: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const name of readdirSync(dir)) {
    const match = /^(\d+)_.+\.sql$/.exec(name);
    if (!match) continue;
    files.push({ no: Number(match[1]), name, filePath: path.join(dir, name) });
  }
  files.sort((a, b) => a.no - b.no);
  for (let i = 1; i < files.length; i++) {
    if (files[i].no === files[i - 1].no) {
      throw new Error(
        `중복 마이그레이션 번호 ${files[i].no}: ${files[i - 1].name} / ${files[i].name}`,
      );
    }
  }
  return files;
}

export function getUserVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get<{ user_version: number }>();
  return row?.user_version ?? 0;
}

/**
 * 미적용 마이그레이션을 순서대로 적용하고 적용한 파일명 목록을 반환한다.
 * 이미 최신이면 빈 배열 (no-op).
 */
export function migrate(
  db: Db,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): string[] {
  const current = getUserVersion(db);
  const applied: string[] = [];
  for (const file of listMigrationFiles(migrationsDir)) {
    if (file.no <= current) continue;
    const sql = readFileSync(file.filePath, "utf8");
    db.transaction(() => {
      db.exec(sql);
      // file.no는 파일명 정규식에서 나온 정수라 인터폴레이션이 안전하다.
      db.exec(`PRAGMA user_version = ${file.no}`);
    });
    applied.push(file.name);
  }
  return applied;
}
