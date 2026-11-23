# Estrategia PWA y Actualizaciones (Trazena Update & Recovery)

## Configuración PWA

- Implementada con `@angular/service-worker` (`ngsw-config.json`) y `public/manifest.webmanifest` con rutas relativas (`./`) compatibles con subruta `/Trazena/` en GitHub Pages.
- **Separación estricta:** el Service Worker cachea únicamente el app shell y assets estáticos. `/api/**` está excluido explícitamente; los documentos viven en IndexedDB.

## Comprobación y aplicación segura

- **Automática:** al iniciar la app, al volver visible la pestaña tras 30 minutos y cada 6 horas mientras esté activa (`SwUpdate`). Nunca activa sincronización documental.
- **Manual:** controles separados en *Configuración → Actualizaciones y diagnóstico* (`Buscar actualizaciones`, `Actualizar ahora`, `Reintentar actualización`).
- **Protección de trabajo en curso:** `TrazenaUpdateService` bloquea la recarga si el editor tiene texto sin persistir en IndexedDB (`hasUnsavedEditorDraft`). Las operaciones pendientes en `sync_outbox` se preservan intactas durante la actualización.
