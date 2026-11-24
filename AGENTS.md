# AGENTS.md — Trazena

## Regla obligatoria de costo USD 0 (Solo capas gratuitas)

- **PROHIBIDO** utilizar, habilitar, actualizar o contratar servicios de pago en cualquier proveedor.
- Todas las cuotas y recursos deben permanecer estrictamente dentro del nivel gratuito:
  - **Cloudflare:** únicamente plan gratuito (**Workers Free** + **D1 Free 5 GB**). Nunca habilitar planes pagos, queues pagas ni add-ons facturables.
  - **Hosting:** **GitHub Pages** gratuito.
- Antes de crear o modificar cualquier recurso de infraestructura, verificar que esté cubierto al 100 % por el tier gratuito.

## Arquitectura y Design System

- **Atralume** (`@osmanjimenez/atralume`) es el design system oficial; consumir desde npm sin rutas locales ni symlinks.
- Nunca mezclar modelos de negocio de Trazena (`Organization`, `Workspace`, `Page`) dentro de Atralume.
- Nunca guardar documentos Markdown en `localStorage`; usar IndexedDB (`IndexedDbService`) y Cloudflare D1.
- Toda autorización ocurre en el Worker (`apps/api`) verificando el JWT HS256 nativo del propietario (PBKDF2-SHA256 + Web Crypto, secretos en Cloudflare) y la pertenencia en D1.
