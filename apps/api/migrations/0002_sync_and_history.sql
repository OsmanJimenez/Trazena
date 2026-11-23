-- Trazena D1 Schema — Migration 0002 (Incremental Sync, History Snapshots & Devices)
-- Expand-only migration: preserves all 0001_initial.sql tables and data intact.
PRAGMA foreign_keys = ON;

-- 1. Incremental replication events (minimal metadata only; never stores Markdown body or error logs)
CREATE TABLE IF NOT EXISTS sync_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('organization', 'workspace', 'page')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'move', 'archive', 'restore', 'delete')),
  revision INTEGER,
  operation_id TEXT NOT NULL UNIQUE,
  device_id TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_org_seq
  ON sync_events(organization_id, sequence ASC);

CREATE INDEX IF NOT EXISTS idx_sync_events_seq
  ON sync_events(sequence ASC);

-- 2. Page History Versions (full Markdown snapshots, rotated to max 3 previous versions per page)
CREATE TABLE IF NOT EXISTS page_history_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  source_device_id TEXT,
  sync_operation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_page_history_page_created
  ON page_history_versions(page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_history_org_created
  ON page_history_versions(organization_id, created_at DESC);

-- 3. Registered Sync Devices (per user, human-readable label, no telemetry tracking)
CREATE TABLE IF NOT EXISTS sync_devices (
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  last_synced_at TEXT,
  app_version TEXT NOT NULL DEFAULT '0.2.0',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_devices_user
  ON sync_devices(user_id, updated_at DESC);
