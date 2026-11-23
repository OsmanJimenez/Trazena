# Historial de Versiones por Página

## Política de snapshots

- Cada página conserva su versión vigente y **máximo 3 versiones anteriores** (`page_history_versions` en D1 y `page_history` en IndexedDB).
- Cada versión es un **snapshot completo en Markdown** (no se almacenan diffs por línea; las diferencias visuales se calculan bajo demanda en memoria con `computeLineDiff`).
- **Deduplicación por hash:** antes de crear un snapshot se compara el hash SHA-256 (`computeContentHash`). Cambios idénticos o exclusivamente de metadatos/orden no crean snapshots duplicados.
- **Rotación automática por cantidad:** al superar 3 versiones anteriores en una página, se elimina automáticamente la más antigua sin tocar jamás la versión actual.
- **Antigüedad (> 30 días):** las versiones mayores de 30 días se marcan visualmente en la interfaz. **No existe borrado automático por antigüedad ni Cron Triggers**; la eliminación es siempre manual (individual o por lotes con confirmación en Configuración → Almacenamiento e historial).
- **Restauración no destructiva:** restaurar una versión crea una nueva revisión vigente y somete la anterior a la misma rotación de 3 versiones.
