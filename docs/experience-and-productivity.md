# Trazena Experience & Productivity v1

## Arquitectura y módulos añadidos

1. **Importación avanzada (`/import` — `ImportEngineService` + `ImportWizardComponent`)**
   - Formatos: `.md`, `.markdown`, carpetas Markdown/Obsidian (`webkitdirectory`), archivos `.zip` (Notion/Obsidian/Trazena) y respaldos JSON v2 de Trazena.
   - Seguridad: protección contra ZIP Slip (`../`, rutas absolutas), límite de 15 MB por archivo, 400 entradas y 30 MB descomprimidos, saneamiento de `<script>` y handlers inline.
   - Vista previa no destructiva (páginas, carpetas, duplicados por título/hash, enlaces sin resolver, recursos locales faltantes) antes de confirmar.
   - Modos: *Contenido nuevo* (IDs nuevos + reescritura de `[[wikilinks]]` y enlaces relativos `.md` a `trazena://page/<id>`) y *Restaurar exportación Trazena* (con confirmación explícita).

2. **Pestañas y Vista Dividida (`WorkspaceTabsService`, `WorkspaceTabsBarComponent`, `SplitPanePreviewComponent`)**
   - Pestañas locales por dispositivo (nunca sincronizadas a D1) con cierre, cerrar otras, limpiar, reordenación y restauración automática al recargar.
   - Split View de máximo 2 paneles en escritorio con divisor redimensionable (ratón y teclado `←`/`→`/`Home`) y proporción `50/50`. En móvil se mantiene un solo panel legible.

3. **Editor Markdown enriquecido (`PageEditorComponent` + `markdown.util.ts`)**
   - Markdown continúa siendo la única fuente de verdad (sin formato propietario de bloques).
   - 3 modos: **Visual** (Tiptap WYSIWYG), **Markdown** (fuente sin pérdidas para Mermaid/KaTeX/Callouts/frontmatter) y **Vista previa** (renderizado sanitizado con DOMPurify).
   - **Mermaid** (`securityLevel: 'strict'`, 100 % offline), **KaTeX** inline `$...$` y bloque `$$...$$`, **Callouts** portables (`> [!NOTE|INFO|TIP|WARNING|DANGER]`), bloques de código con resaltado, botón **Copiar** y **Plegar/Expandir**, controles de tabla (`+Fila`, `-Fila`, `+Col`, `-Col`), menú contextual `/` (sin interceptar dentro de bloques de código), **Buscar y reemplazar**, **Extraer selección a subpágina**, **Fusionar páginas**, **Previsualización de enlaces internos** (con *Abrir en otro panel*) y **Recuperación local de borradores** (`DraftRecoveryService`, separada del historial de 3 versiones).

4. **Productividad y navegación**
   - **Paleta de comandos** (`Ctrl+Shift+P` — `CommandPaletteDialogComponent`).
   - **Atajos configurables** (`/settings/shortcuts` — `ShortcutsService` con detección de conflictos y bloqueo de combinaciones reservadas del navegador).
   - **Inicio personalizable** (`HomeDashboardComponent` + `HomePreferencesService`: mostrar/ocultar y reordenar secciones, espacios fijados, sin consultas remotas).

5. **Mantenimiento y funciones temporales**
   - **Salud del conocimiento** (`/health` — `KnowledgeHealthService`): revisión explícita (`lastReviewedAt` sin crear snapshot de historial), plazo configurable por organización (default 90 días), enlaces internos rotos, posibles duplicados, páginas sin backlinks, etiquetas sin uso y listado manual de enlaces externos respetando CORS.
   - **Papelera mejorada** (`/settings`): restauración individual, restauración de ramas completas (`restorePageBranch`), espacios y organizaciones eliminados.
   - **Notas diarias** (`/daily` — `DailyNotesService`): páginas estándar de Trazena indexadas por fecha calendario local (`YYYY-MM-DD`, sin errores de zona horaria), plantilla y espacio configurables.
   - **Recordatorios locales** (`/reminders` — `RemindersService`): vencidos, próximos y completados, detección al abrir/enfocar la pestaña sin servidores push ni servicios pagos.

## Exclusiones respetadas
- **Sin Captura Rápida** (Quick Capture / Inbox flotante).
- **Sin Web Share Target** (compartir desde Android).
- **Sin pruebas automatizadas ni E2E** en esta fase.
- **Sin conexión ni ejecución sobre Cloudflare D1 remoto** (solo migración SQL preparada `0004_experience_and_productivity.sql`).
