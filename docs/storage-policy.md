# Política de Almacenamiento y Costo USD 0

## Límites gratuitos respetados

- **Cloudflare Workers Free:** 100.000 peticiones/día. Sincronización estrictamente manual por lotes para minimizar invocaciones.
- **Cloudflare D1 Free:** 5 GB de almacenamiento. Sin logs diagnósticos en D1 y sin Markdown duplicado en `sync_events`.
- **Firebase Spark:** únicamente Firebase Authentication (Email/Password).
- **GitHub Pages:** hosting gratuito del bundle Angular PWA.

## Métricas visibles

En *Configuración → Almacenamiento e historial* se diferencian explícitamente:
- Tamaño lógico del contenido Markdown vigente.
- Tamaño lógico de snapshots de historial.
- Estimación de metadatos e índices frente a la cuota gratuita de 5 GB de D1.
- Cuota IndexedDB reportada por `navigator.storage.estimate()`.
- Estado de almacenamiento persistente (`navigator.storage.persist()`).
