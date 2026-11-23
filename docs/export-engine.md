# Motor de Exportación Multiformato (`ExportEngineService`)

## Principios

- **100 % cliente / offline-first:** todos los formatos se generan en el navegador usando `jsPDF`, `jspdf-autotable`, `JSZip`, `marked` y `DOMPurify`.
- **Costo USD 0:** no utiliza servicios externos ni conversores PDF en la nube.
- **Manual-Sync:** exportar nunca activa sincronización remota.
- **Cancelación y progreso:** `ExportEngineService.progress` expone fase (`preparing`, `processing`, `generating`, `packaging`, `completed`, `cancelled`, `error`), conteo de páginas y soporte de cancelación (`cancelCurrentExport()`).

## Alcances soportados

1. **Página individual (`page`)**
2. **Página + subárbol descendiente (`page-tree`)**
3. **Espacio completo (`workspace`)**
4. **Organización completa (`organization`)**
5. **Selección arbitraria / resultados filtrados (`selection`)** desde el Explorador (`/explore`)

## Puntos de entrada en la UI

- **Página:** botón **Exportar** en la barra superior de `PageViewComponent` (permite alternar *Incluir subpáginas*).
- **Espacio:** botón **Exportar** en `WorkspaceViewComponent`.
- **Organización:** botón **Exportar** en `OrganizationViewComponent`.
- **Explorador (`/explore`):** selección múltiple + botón **Exportar** en la barra de acciones masivas.

## Preferencias persistentes

Las últimas opciones seleccionadas (`format`, `includeArchived`, `includeMetadata`, `pdfMode`) se guardan localmente en `app_meta` (`export_preferences`).
