# Formatos de Exportación Soportados

## 1. PDF (`pdf`)

Generado localmente con **jsPDF** y **jspdf-autotable** en formato A4 con texto seleccionable:

- **Página individual / PDF consolidado (`combined`):** incluye portada, tabla de contenido jerárquica, encabezados tipográficos, párrafos, citas, listas, bloques de código monoespaciados, tablas, etiquetas/propiedades opcionales y numeración de páginas.
- **PDFs independientes (`separate`):** genera un PDF por página empaquetado en un archivo `.zip` respetando la jerarquía de carpetas + `manifest.json` y `README.md`.

## 2. Markdown (`markdown`)

- **Una sola página:** descarga directa `.md` con frontmatter YAML opcional (`id`, `title`, `slug`, `revision`, `tags`, `properties`).
- **Múltiples páginas / árboles:** archivo `.zip` con estructura de directorios jerárquica (`content/<org>/<espacio>/<pagina>/index.md`), enlaces internos `trazena://page/<id>` reescritos a rutas relativas, `manifest.json`, `README.md` y `metadata/entities.json`.

## 3. HTML autónomo (`html`)

- Renderizado desde Markdown con `marked` y sanitizado con `DOMPurify`.
- CSS embebido con tipografía legible, modo impresión (`@media print`), sin dependencias externas.
- Para exportaciones múltiples genera un `.zip` navegable con `index.html` raíz y páginas enlazadas.

## 4. JSON estructurado v2 (`json`)

- Esquema `FullJsonExportPayload` (`schemaVersion: 2`) con organizaciones, espacios, páginas, contenidos, etiquetas, asignaciones, definiciones y valores de propiedades, vistas guardadas y plantillas.
- **Seguridad:** excluye explícitamente tokens de autenticación, credenciales, estado de sesión y logs de diagnóstico (`trazena-diagnostics`).

## Prevención de colisiones de rutas

Todas las rutas dentro de archivos ZIP pasan por normalización de segmentos seguros y deduplicación determinista para evitar colisiones entre títulos o slugs repetidos.
