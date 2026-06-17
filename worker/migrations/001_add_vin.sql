-- Migration: Add VIN column to vehicles table
-- すでにschema.sqlを実行済みのD1データベースに対して、
-- このSQLをD1のConsoleタブで追加実行してください。
-- (新規にD1をセットアップする場合は、schema.sql実行後にこちらも実行してください)

ALTER TABLE vehicles ADD COLUMN vin TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
