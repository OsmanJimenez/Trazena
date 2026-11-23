-- Trazena D1 Schema — Migration 0001 (Initial)
PRAGMA foreign_keys = ON;

-- 1. Users (authenticated via Firebase Auth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Organizations (isolated logical contexts)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  position TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_owner_slug
  ON organizations(owner_id, slug)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_organizations_owner_status
  ON organizations(owner_id, status, position);

-- 3. Organization Members (RBAC ready for multi-user evolution)
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members(user_id);

-- 4. Workspaces (thematic spaces inside an organization)
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  position TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_org_slug
  ON workspaces(organization_id, slug)
  WHERE status != 'deleted';

CREATE INDEX IF NOT EXISTS idx_workspaces_org_status
  ON workspaces(organization_id, status, position);

-- 5. Workspace Permissions (granular overrides for future collaboration)
CREATE TABLE IF NOT EXISTS workspace_permissions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

-- 6. Pages (recursive hierarchical document metadata, separated from body)
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  position TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pages_workspace_parent
  ON pages(workspace_id, parent_id, status, position);

CREATE INDEX IF NOT EXISTS idx_pages_org_status
  ON pages(organization_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_sibling_slug_root
  ON pages(workspace_id, slug)
  WHERE parent_id IS NULL AND status != 'deleted';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_sibling_slug_child
  ON pages(workspace_id, parent_id, slug)
  WHERE parent_id IS NOT NULL AND status != 'deleted';

-- 7. Page Contents (Markdown body separated from navigation metadata)
CREATE TABLE IF NOT EXISTS page_contents (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL DEFAULT '',
  excerpt TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

-- 8. Page Route Aliases (redirect old hierarchical URLs after move/rename)
CREATE TABLE IF NOT EXISTS page_route_aliases (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  old_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_route_aliases_lookup
  ON page_route_aliases(organization_id, workspace_id, old_path);

CREATE INDEX IF NOT EXISTS idx_page_route_aliases_page
  ON page_route_aliases(page_id);

-- 9. User Preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  sidebar_width INTEGER NOT NULL DEFAULT 280,
  last_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  last_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  last_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  editor_mode TEXT NOT NULL DEFAULT 'split' CHECK (editor_mode IN ('edit', 'split', 'preview')),
  updated_at TEXT NOT NULL
);

-- 10. Full-Text Search (FTS5) over active pages + markdown content
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  page_id UNINDEXED,
  organization_id UNINDEXED,
  title,
  markdown,
  tokenize = 'unicode61 remove_diacritics 2'
);
