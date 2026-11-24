-- Trazena Experience & Productivity v1 (Expand-Only Migration)
-- Prepared for future Cloudflare D1 connection. Do NOT run remotely in this phase.

ALTER TABLE pages ADD COLUMN last_reviewed_at TEXT;

CREATE TABLE IF NOT EXISTS organization_review_policies (
  organization_id TEXT PRIMARY KEY,
  review_cycle_days INTEGER NOT NULL DEFAULT 90,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS page_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  due_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  snoozed_until TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_page_reminders_user_status
  ON page_reminders(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_page_reminders_page
  ON page_reminders(page_id);

CREATE TABLE IF NOT EXISTS daily_notes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  note_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, note_date),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_notes_org_date
  ON daily_notes(organization_id, note_date DESC);
