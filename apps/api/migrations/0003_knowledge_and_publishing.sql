-- Trazena D1 Schema — Migration 0003 (Knowledge Organization: Tags, Properties, Saved Views, Templates, Favorites)
-- Expand-only migration: preserves 0001 and 0002 tables and data intact.
PRAGMA foreign_keys = ON;

-- 1. Organization-scoped reusable Tags
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#0f766e',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_org_normalized
  ON tags(organization_id, normalized_name)
  WHERE status != 'deleted';

-- 2. Page-to-Tag relation (many-to-many without duplicating page content)
CREATE TABLE IF NOT EXISTS page_tags (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_tags_unique
  ON page_tags(page_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_page_tags_tag
  ON page_tags(tag_id);

-- 3. Custom Property Definitions (extensible schema, no ALTER TABLE per user property)
CREATE TABLE IF NOT EXISTS property_definitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'boolean', 'select', 'multi-select')),
  options_json TEXT NOT NULL DEFAULT '[]',
  position TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prop_defs_org
  ON property_definitions(organization_id, status, position);

-- 4. Custom Property Values bound to pages and valid definitions
CREATE TABLE IF NOT EXISTS property_values (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  value_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prop_values_page_prop
  ON property_values(page_id, property_id);

CREATE INDEX IF NOT EXISTS idx_prop_values_org
  ON property_values(organization_id, property_id);

-- 5. Saved Content Explorer Views (stores filter/sort/group criteria, never copies results)
CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_views_user
  ON saved_views(user_id, status);

-- 6. Reusable Editable Document Templates
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL DEFAULT '',
  markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_user
  ON templates(user_id, status);

-- 7. Per-User Favorites (user preference, never global shared page property)
CREATE TABLE IF NOT EXISTS user_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_unique
  ON user_favorites(user_id, page_id);
