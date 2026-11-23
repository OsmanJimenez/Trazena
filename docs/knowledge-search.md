# Motor de Búsqueda Local-First (`SearchEngineService`)

## Arquitectura

La búsqueda de Trazena funciona **100 % en local y sin conexión** utilizando **MiniSearch** sobre el almacenamiento persistente en IndexedDB (`trazena_vault_v1`). Ninguna consulta dispara llamadas remotas ni sincronización automática.

- **Archivo:** `apps/web/src/app/core/search/search-engine.service.ts`
- **Búsqueda rápida global:** `QuickSearchDialogComponent` (`Ctrl+K` / `Cmd+K` o botón **Buscar** en la barra superior / lateral).
- **Explorador avanzado:** `ContentExplorerComponent` (`/explore`).

## Normalización y Ranking

- Normalización Unicode (`NFD`) con eliminación de diacríticos para consultas en español e inglés (`"arquitectura"` coincide con `"Arquitectura"` y `"configuracion"` con `"configuración"`).
- Ponderación por campo:
  - `title`: 5×
  - `headings`: 3×
  - `tags`: 2.5×
  - `properties`: 2×
  - `content`: 1×
- Soporte de búsqueda por prefijo y tolerancia a pequeños errores tipográficos (`fuzzy: 0.2`).
- **Actualización incremental:** al guardar una página (`PageEditorComponent`), modificar etiquetas o propiedades (`PageKnowledgePanelComponent`), se llama a `upsertPage()` sin reconstruir todo el índice.

## Seguridad XSS en Snippets

Los fragmentos resaltados (`snippetHtml`) escapan primero cualquier HTML (`&`, `<`, `>`, `"`, `'`) antes de insertar etiquetas `<mark>`, garantizando renderizado seguro sin ejecución de scripts.

## Filtros Combinables (AND / OR)

El evaluador `evaluateFilterGroup()` soporta grupos anidados con lógica `AND` / `OR` sobre:

- `organizationId`, `workspaceId`, `subtreeRootPageId`
- `title`, `content`, `status`, `isFavorite`, `hasPendingSync`
- `tags` (`contains`, `not_contains`, `in`)
- `property:<propertyId>` (texto, número, fecha, booleano, select, multi-select)
- `createdAt` / `updatedAt` (`before`, `after`, `between`)
