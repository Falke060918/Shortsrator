-- 001_init — 전체 스키마.
-- 기준: docs/01_솔루션_개발명세.md §8 채택 + docs/03-architecture.md 수정 4건
--   수정 1: shots 길이 전부 ms 정수 (duration_ms, adopted_in_ms/out_ms)
--   수정 2: jobs 테이블 신설 (비용 추적 §10 · 크래시 재개 · MANUAL 대기의 원천)
--   수정 3: generated_assets.meta_json (모델·seed·motion_id·사용 프롬프트 — 재현성)
--   수정 4: channels·uploads는 P2 마이그레이션으로 연기, settings KV 추가
-- 산출물은 파일이 원천, DB는 메타만. *_json 컬럼은 JSON 직렬화 문자열.

CREATE TABLE themes (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  status             TEXT NOT NULL
                     CHECK (status IN ('DRAFT','TESTING','FIXED','ARCHIVED')),
  channel_id         TEXT,             -- channels는 P2 — FK 없이 자리만 둔다
  current_version_id TEXT,             -- theme_versions.id (상호 참조라 FK 미지정)
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE theme_versions (
  id         TEXT PRIMARY KEY,
  theme_id   TEXT NOT NULL REFERENCES themes(id),
  version_no INTEGER NOT NULL,
  rules_json TEXT NOT NULL,            -- style_string·camera_grammar·script_rules 등 규칙 세트
  changelog  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (theme_id, version_no)
);

-- 주제 큐
CREATE TABLE topics (
  id         TEXT PRIMARY KEY,
  theme_id   TEXT NOT NULL REFERENCES themes(id),
  title      TEXT NOT NULL,
  status     TEXT NOT NULL,
  source     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE episodes (
  id               TEXT PRIMARY KEY,
  theme_version_id TEXT NOT NULL REFERENCES theme_versions(id),
  topic_id         TEXT NOT NULL REFERENCES topics(id),
  state            TEXT NOT NULL
                   CHECK (state IN ('TOPIC','SCRIPT','SCRIPT_GATE','TTS','SHOTLIST',
                                    'MASTER_ASSET','FRAME_GEN','FRAME_GATE','VIDEO_GEN',
                                    'CLIP_GATE','ASSEMBLY','FINAL_GATE','UPLOAD','PUBLISHED')),
  metrics_json     TEXT,               -- 편 종료 시 자동 기록 (승인률·채택률·소요 시간)
  cost_json        TEXT,               -- 편당 비용 집계 (크레딧/원)
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE shots (
  id                TEXT PRIMARY KEY,
  episode_id        TEXT NOT NULL REFERENCES episodes(id),
  idx               INTEGER NOT NULL,  -- 샷 순번 (0-base)
  narration         TEXT NOT NULL,     -- 내레이션 문장 1개 = 샷 1개
  duration_ms       INTEGER NOT NULL,  -- 수정 1: 문장별 TTS 파일의 로컬 ffprobe 실측(ms)
  gen_method        TEXT NOT NULL
                    CHECK (gen_method IN ('I2V','START_END','T2V','EDIT_ONLY')),
  camera_moves_json TEXT NOT NULL DEFAULT '[]',
  image_prompt      TEXT NOT NULL,     -- 피사체 기술 + 테마 style_string 고정 부착
  motion_prompt     TEXT NOT NULL,
  transition_type   TEXT               -- START_END 전환 방식 (강등 체인의 현재 위치)
                    CHECK (transition_type IN ('frames','edit_splice','manual')),
  fallback_json     TEXT NOT NULL DEFAULT '[]',
  adopted_asset_id  TEXT,              -- generated_assets.id (상호 참조라 FK 미지정)
  adopted_in_ms     INTEGER,           -- 수정 1: GATE3 채택 구간 (0.1초=100ms 단위 입력)
  adopted_out_ms    INTEGER,
  UNIQUE (episode_id, idx)
);

CREATE TABLE generated_assets (
  id            TEXT PRIMARY KEY,
  shot_id       TEXT NOT NULL REFERENCES shots(id),
  kind          TEXT NOT NULL,         -- frame | clip 등
  file_path     TEXT NOT NULL,         -- workspace 상대 경로 (파일이 원천)
  gen_round     INTEGER NOT NULL DEFAULT 1,
  approved      INTEGER,               -- NULL=미판정, 1=승인, 0=반려
  reject_reason TEXT,
  meta_json     TEXT,                  -- 수정 3: 모델·seed·motion_id·사용 프롬프트
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 주제당 기준 이미지 (테마 master_asset_schema의 role별 1장)
CREATE TABLE master_assets (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL REFERENCES topics(id),
  role       TEXT NOT NULL,            -- 예: exterior/interior/section/cutaway
  file_path  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE gate_decisions (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES episodes(id),
  gate         TEXT NOT NULL
               CHECK (gate IN ('SCRIPT_GATE','FRAME_GATE','CLIP_GATE','FINAL_GATE')),
  decision     TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  payload_json TEXT,
  decided_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 수정 2: jobs 신설
CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES episodes(id),
  shot_id      TEXT REFERENCES shots(id),
  kind         TEXT NOT NULL,          -- llm_script | tts | image_gen | video_i2v 등
  adapter      TEXT NOT NULL,          -- elevenlabs | typecast | higgsfield | manual 등
  status       TEXT NOT NULL
               CHECK (status IN ('queued','running','manual_pending','succeeded','failed')),
  request_id   TEXT,                   -- 벤더 측 비동기 요청 ID (Higgsfield request_id)
  cost_credits REAL,
  cost_krw     REAL,
  payload_json TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 수정 4: settings KV (어댑터 모드 · TTS 벤더 선택 · 예산 한도)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_theme_versions_theme   ON theme_versions(theme_id);
CREATE INDEX idx_topics_theme_status    ON topics(theme_id, status);
CREATE INDEX idx_episodes_state         ON episodes(state);
CREATE INDEX idx_shots_episode          ON shots(episode_id);
CREATE INDEX idx_generated_assets_shot  ON generated_assets(shot_id);
CREATE INDEX idx_gate_decisions_episode ON gate_decisions(episode_id);
CREATE INDEX idx_jobs_episode           ON jobs(episode_id);
CREATE INDEX idx_jobs_status            ON jobs(status);
