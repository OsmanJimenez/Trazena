# Migraciones de Base de Datos (D1 e IndexedDB)

## Regla Expand → Migrate → Contract

Nunca modificar migraciones ya aplicadas en producción. Cada cambio estructural crea una nueva migración incremental.

## Cloudflare D1 (`apps/api/migrations/`)

- `0001_initial.sql`: esquema base (`users`, `organizations`, `organization_members`, `workspaces`, `workspace_permissions`, `pages`, `page_contents`, `page_route_aliases`, `user_preferences`, `pages_fts`).
- `0002_sync_and_history.sql`: `sync_events`, `page_history_versions`, `sync_devices`.
- `0003_knowledge_and_publishing.sql`: tablas expand-only para Knowledge & Publishing v1 (`tags`, `page_tags`, `property_definitions`, `property_values`, `saved_views`, `templates`, `user_favorites`).
- **Las migraciones D1 jamás se ejecutan desde el navegador.** Se aplican en el despliegue del backend:
  ```bash
  npm run db:migrate:local
  npm run db:migrate:remote
  ```

## IndexedDB (`trazena_vault_v1`)

- Migraciones explícitas y no destructivas en `onupgradeneeded`:
  - `v1 → v2`: almacenes de sincronización, historial y preferencias locales (`sync_outbox`, `sync_conflicts`, `page_history`, `app_meta`, `sync_devices`).
  - `v2 → v3`: almacenes de Knowledge & Publishing (`tags`, `page_tags`, `property_definitions`, `property_values`, `saved_views`, `templates`, `favorites`, `recent_visits`).
- Detección de bloqueo entre pestañas (`onblocked` / `onversionchange`) con aviso limpio y registro en `trazena-diagnostics`.
- Ante un fallo, nunca se borra IndexedDB ni se intenta un downgrade destructivo.
