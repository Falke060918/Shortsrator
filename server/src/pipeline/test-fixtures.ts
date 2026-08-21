/**
 * pipeline 테스트 공용 픽스처 — 실제 SQLite(임시 파일) + 테마→버전→주제→에피소드 시드.
 * dao.test.ts 의 시드 패턴을 그대로 따른다. 테스트 전용 (제품 코드에서 import 금지).
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDao, type Dao } from "../db/dao.js";
import { openDb, type Db } from "../db/db.js";
import { migrate } from "../db/migrate.js";

export interface TestDb {
  db: Db;
  dao: Dao;
  close(): void;
}

export function openTestDb(): TestDb {
  const dir = mkdtempSync(path.join(os.tmpdir(), "shortsrator-pipeline-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db);
  const dao = createDao(db);
  return {
    db,
    dao,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface SeededEpisode {
  themeId: string;
  versionId: string;
  topicId: string;
  episodeId: string;
}

/** 테마→버전→주제→에피소드(TOPIC)까지 시드 */
export function seedEpisode(dao: Dao): SeededEpisode {
  const themeId = randomUUID();
  dao.themes.insert({
    id: themeId,
    name: "신비한 건축 사전",
    status: "DRAFT",
    channel_id: null,
    current_version_id: null,
  });
  const versionId = randomUUID();
  dao.themeVersions.insert({
    id: versionId,
    theme_id: themeId,
    version_no: 1,
    rules_json: JSON.stringify({ style_string: "cinematic" }),
    changelog: "최초 버전",
  });
  dao.themes.setCurrentVersion(themeId, versionId);
  const topicId = randomUUID();
  dao.topics.insert({
    id: topicId,
    theme_id: themeId,
    title: "판테온",
    status: "QUEUED",
    source: "manual",
  });
  const episodeId = randomUUID();
  dao.episodes.insert({
    id: episodeId,
    theme_version_id: versionId,
    topic_id: topicId,
    state: "TOPIC",
    metrics_json: null,
    cost_json: null,
  });
  return { themeId, versionId, topicId, episodeId };
}
