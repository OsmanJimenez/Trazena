# Protocolo de Sincronización Incremental (Trazena Sync)

## Endpoints

1. **`GET /api/version`** (público, sin consultas documentales): informa `apiVersion`, `syncProtocolVersion`, `remoteSchemaVersion` y `minimumCompatibleAppVersion`.
2. **`POST /api/sync/push`** (autenticado RS256 + autorización D1): recibe un lote de operaciones consolidadas con `operationId` inmutable.
   - **Idempotencia:** si `operation_id` ya existe en `sync_events`, responde `status: 'duplicate'` sin duplicar entidades ni snapshots.
   - **Control de concurrencia:** nunca aplica *last-write-wins* sobre contenido Markdown. Si `baseRevision !== current.revision`, aísla el documento respondiendo `status: 'conflict'` con `serverRevision` y `serverMarkdown`, permitiendo que las operaciones sin conflicto continúen.
3. **`GET /api/sync/pull?since=<sequence>&limit=100`** (autenticado): consulta eventos en `sync_events` con `sequence > since` filtrados por `organization_members`.
   - Devuelve `latestSequence`, `hasMore`, `requiresFullResync` y las entidades afectadas con su contenido Markdown.
   - Si el cursor es `0` o anterior al primer evento retenido, realiza descarga de referencia completa sin borrar la Outbox local.

## Flujo de un clic ("Sincronizar ahora")

1. Comprobar conectividad y compatibilidad (`/api/version`).
2. Enviar operaciones pendientes en orden causal (`organization → workspace → page`).
3. Confirmar aplicadas/duplicadas y aislar conflictos en `sync_conflicts`.
4. Descargar lotes incrementales respetando páginas con cambios locales pendientes.
5. Avanzar `SyncCheckpoint.lastAppliedSequence` **únicamente** después de persistir en IndexedDB.
6. Registrar resumen local (`SyncSessionSummary`).
