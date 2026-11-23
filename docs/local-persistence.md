# Persistencia Local (IndexedDB v2)

## Stores en `trazena_vault_v1` (esquema v2)

- **v1 preservados:** `organizations`, `workspaces`, `pages`, `page_contents`, `route_aliases`, `sync_queue`, `meta`.
- **v2 agregados (expansión no destructiva):** `page_history`, `sync_outbox`, `sync_checkpoints`, `sync_sessions`, `sync_conflicts`, `sync_device`.

## Invariantes

- **Escritura atómica:** `IndexedDbService.commitAtomicWithOutbox` guarda la entidad (y su `PageContent`) junto con su registro en `sync_outbox` dentro de una única transacción `readwrite` de IndexedDB.
- **Consolidación de Outbox:** múltiples ediciones sobre la misma entidad antes de sincronizar se consolidan en una sola mutación pendiente, preservando la `baseRevision` original.
- **Aislamiento y privacidad:** los registros de Outbox, checkpoints, conflictos y sesiones están particionados por `ownerUid`. IndexedDB **no está cifrado por Trazena**; los documentos sincronizados pueden permanecer localmente tras expirar una sesión remota.
- **Nunca en `localStorage`:** ningún documento Markdown se persiste en `localStorage`.
