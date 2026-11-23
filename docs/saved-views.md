# Vistas Guardadas y Explorador de Contenido (`/explore`)

## Explorador de Contenido (`ContentExplorerComponent`)

Disponible en `/explore` y desde el botón **Explorar** del panel lateral.

Capacidades:
- **Búsqueda full-text** en tiempo real combinada con filtros estructurados (`AND` / `OR`).
- **Filtros por:** organización, espacio, etiqueta, estado (`active` / `archived`), solo favoritos, solo cambios pendientes de sincronización y rango de fechas (`desde` / `hasta`).
- **Modos de vista:** Lista detallada (con snippets resaltados y ruta canónica) y Tabla estructurada (título, ubicación, etiquetas, estado y actualización).
- **Ordenación:** relevancia, última actualización, fecha de creación o título.
- **Agrupación:** sin agrupar, por organización, por espacio o por estado.
- **Acciones masivas:** seleccionar múltiples páginas para **Exportar**, **+ Etiqueta**, **★ Favorito**, **Archivar** o **Restaurar**.

## Vistas Guardadas (`SavedView`)

Permite guardar la combinación actual de consulta, filtros, modo de vista, ordenación y agrupación con un nombre personalizado.

- Se persisten en IndexedDB (`saved_views`) con registro en la Outbox (`entityType: 'saved_view'`).
- Se sincronizan manualmente con la tabla `saved_views` de Cloudflare D1.
- Al hacer clic en una vista guardada, se restauran todos sus parámetros instantáneamente sin llamadas de red.
