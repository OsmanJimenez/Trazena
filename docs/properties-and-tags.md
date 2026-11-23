# Etiquetas y Propiedades Personalizadas

## Etiquetas (`Tag` y `PageTag`)

- Scoped por organización (`organizationId`), con color visual y normalización case/accent-insensitive (`normalizedName`) para evitar duplicados.
- Se gestionan directamente desde `PageKnowledgePanelComponent` en cada página o de forma masiva desde `/explore` (**+ Etiqueta**).
- Sincronizables mediante la Outbox (`entityType: 'tag'` y `'page_tag'`) y tablas D1 `tags` y `page_tags`.

## Propiedades Personalizadas (`PropertyDefinition` y `PropertyValue`)

Cada organización puede definir esquemas de metadatos estructurados reutilizables en todas sus páginas.

Tipos soportados:
1. `text` — texto libre
2. `number` — valor numérico
3. `date` — fecha ISO (`YYYY-MM-DD`)
4. `boolean` — casilla verdadero/falso
5. `select` — lista de opciones únicas
6. `multi-select` — selección múltiple de opciones

Todas las escrituras son atómicas en IndexedDB (`commitAtomicWithOutbox`), actualizan el índice local de búsqueda y se sincronizan manualmente con Cloudflare D1 (`property_definitions`, `property_values`).

## Favoritos y Recientes

- **Favoritos (`UserFavorite`):** preferencia por usuario (`ownerUid`), accesible desde la barra lateral (`★ Favoritos`) y cada página. Sincronizable con `user_favorites` en D1.
- **Recientes (`RecentVisit`):** estrictamente locales en IndexedDB (`recent_visits`), ordenados por última visita, sin generar tráfico de sincronización remota.
