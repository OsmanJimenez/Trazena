# Plantillas Reutilizables (`/templates`)

## Gestión de Plantillas (`TemplatesViewComponent`)

Trazena incluye un catálogo inicial de **8 plantillas editables** listas para usar offline (por ejemplo: *Documento técnico*, *ADR*, *Minuta de reunión*, *Guía operativa / Runbook*, *Especificación funcional*, *Checklist de lanzamiento*, *Retrospectiva* y *Nota rápida*).

Operaciones disponibles en `/templates`:
- **Crear / editar / eliminar** plantillas personalizadas.
- **Guardar página como plantilla** directamente desde el botón **Plantilla** en cualquier página (`PageViewComponent`).
- **Crear página desde plantilla** eligiendo organización, espacio destino y título.

## Variables seguras soportadas

Al instanciar una plantilla, `KnowledgeMetaService.renderTemplateMarkdown()` sustituye únicamente variables seguras predefinidas (sin ejecución de código ni `eval`):

- `{{title}}` — título elegido para la nueva página.
- `{{date}}` — fecha actual en formato ISO (`YYYY-MM-DD`).

## Persistencia y sincronización

Las plantillas se almacenan en IndexedDB (`templates`) y se sincronizan manualmente con la tabla `templates` de Cloudflare D1 (`entityType: 'template'`).
