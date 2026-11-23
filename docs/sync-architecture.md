# Arquitectura Trazena Sync & Update (Local-First)

Trazena opera como una plataforma **Local-First, Offline-Capable, Manual-Sync y Migration-Safe** sobre infraestructura gratuita (USD 0):

- **Frontend PWA (`apps/web`):** Angular 22 + `@osmanjimenez/atralume` + Angular Service Worker (`ngsw-worker.js`) desplegado en GitHub Pages.
- **Persistencia local:** Dos bases IndexedDB independientes:
  - `trazena_vault_v1` (esquema v2): organizaciones, espacios, páginas, contenido Markdown, historial de versiones, outbox consolidada, checkpoints, sesiones, conflictos y dispositivo.
  - `trazena-diagnostics` (esquema v1): bitácora diagnóstica local sanitizada, operativa incluso si falla la base principal.
- **Backend (`apps/api`):** Cloudflare Workers Free + Hono + Cloudflare D1 Free (5 GB). No se utilizan R2, KV, Queues, Durable Objects ni Cron Triggers.
- **Separación estricta de responsabilidades:**
  - `KnowledgeStore`: lecturas y escrituras locales atómicas (nunca dispara red al escribir).
  - `TrazenaSyncService`: sincronización manual bidireccional incremental activada exclusivamente por el usuario.
  - `TrazenaUpdateService`: detección y aplicación controlada de nuevas versiones de la PWA, totalmente independiente de la sincronización documental.
