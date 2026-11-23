# Enlaces Internos, Backlinks y Tabla de Contenidos (TOC)

## Enlaces Internos (`trazena://page/<pageId>`)

Para evitar enlaces rotos cuando una página cambia de título, slug o se mueve entre espacios, Trazena utiliza el esquema inmutable basado en ID:

```markdown
[Guía de sincronización](trazena://page/<pageId>)
```

- **Inserción desde el editor:** botón **`[[Página]]`** en la barra de herramientas de `PageEditorComponent`, que permite elegir la página destino y agrega el enlace Markdown automáticamente.
- **Navegación interna:** hacer clic en un enlace `trazena://page/<id>` dentro del editor resuelve la ruta canónica vigente en `KnowledgeStore` y navega sin recargar la aplicación.
- **Exportación:** al exportar a Markdown ZIP o HTML ZIP, `ExportEngineService` reescribe `trazena://page/<id>` a rutas relativas válidas dentro del paquete exportado.

## Backlinks (Referencias entrantes)

- `KnowledgeMetaService` mantiene un índice en memoria (`rebuildBacklinksIndex()` + `updateBacklinksForPage()`) de todas las páginas que enlazan a cada `pageId`.
- `PageKnowledgePanelComponent` muestra la lista de páginas entrantes con enlaces navegables.

## Tabla de Contenidos (TOC)

- `KnowledgeMetaService.extractToc(markdown)` analiza encabezados `H1`–`H4` respetando bloques de código cercados (` ``` `).
- El panel de la página renderiza el índice interactivo y desplaza suavemente al encabezado correspondiente dentro del documento.
