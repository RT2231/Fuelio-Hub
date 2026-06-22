-- Migration: ログイン・登録のレート制限用テーブルを追加
-- すでにschema.sqlを実行済みのD1データベースに対して、
-- このSQLをD1のConsoleタブで追加実行してください。

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_started_at TEXT NOT NULL
);
