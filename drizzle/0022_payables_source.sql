ALTER TABLE records ADD COLUMN source_key TEXT;
ALTER TABLE records ADD COLUMN source_payload TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS records_source_key_unique ON records(source_key);
