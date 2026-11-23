# Trazena

Plataforma web de gestión del conocimiento y documentación jerárquica (**Organización → Espacio → Página → Subpáginas recursivas → Markdown**).

## Arquitectura del monorepo

```text
Trazena/
├── packages/shared   # @trazena/shared: modelos de dominio, contratos API, slug/ciclos/árbol
├── apps/api          # Cloudflare Workers + Hono + Cloudflare D1 (SQLite + FTS5)
└── apps/web          # Angular 22 + @osmanjimenez/atralume + Firebase Auth + IndexedDB
```

## Integración con Atralume

Trazena consume [`@osmanjimenez/atralume`](https://www.npmjs.com/package/@osmanjimenez/atralume) (`^0.2.5`) directamente desde npm como design system oficial, garantizando compilación reproducible en cualquier entorno de CI sin depender de rutas locales ni symlinks.

Componentes reutilizados de Atralume:
- `provideAtralume()` y `@osmanjimenez/atralume/styles/index.scss` (tokens DTCG y temas `light` / `dark` / `system`).
- `AtralumeButton`, `AtralumeIconButton`, `AtralumeIcon` (`provideAtralumeIcons`), `AtralumeCard`, `AtralumeBreadcrumbs`, `AtralumeEmptyState`, `AtralumeSnackbar`.

Los componentes específicos del dominio (`AppShellComponent`, `PageTreeComponent`, `PageBreadcrumbsComponent`, `PageEditorComponent`, `StorageDashboardComponent`) viven en `apps/web`.

## Desarrollo local

```bash
npm install
npm run build:shared
npm run dev:web        # http://localhost:4200
```

Para ejecutar la API localmente con Cloudflare D1 (SQLite local):

```bash
npm run db:migrate:local
npm run dev:api        # http://127.0.0.1:8787
```

## Configuración de producción (USD 0)

1. **Firebase Authentication:** crea un proyecto en Firebase, habilita Email/Password (sin registro público), crea tu usuario propietario y completa `apps/web/src/environments/environment.prod.ts`.
2. **Cloudflare D1 + Workers:**
   - Crea la base D1: `npx wrangler d1 create trazena-db`
   - Actualiza `database_id` y `FIREBASE_PROJECT_ID` en `apps/api/wrangler.toml`.
   - Ejecuta `npm run db:migrate:remote` y `npm --workspace=@trazena/api run deploy`.
3. **GitHub Pages:** el workflow `.github/workflows/deploy-pages.yml` compila y despliega automáticamente.
   - **Nota sobre GitHub Pages y rutas profundas:** GitHub Pages puede responder con código HTTP `404` al abrir directamente una ruta profunda (por ejemplo `/Trazena/o/nequi/paypal/arquitectura`) antes de que `public/404.html` e `index.html` restauren la ruta canónica mediante History API.
