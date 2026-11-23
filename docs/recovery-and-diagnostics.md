# Recuperación y Diagnóstico Local

## Base independiente (`trazena-diagnostics`)

- Los logs diagnósticos se guardan **exclusivamente en el dispositivo** en una base IndexedDB independiente (`trazena-diagnostics`) que funciona incluso si `trazena_vault_v1` falla al abrir o migrar.
- **Privacidad:** `DiagnosticsService` sanitiza mensajes y **prohíbe registrar** Markdown, contraseñas, tokens Bearer, cookies o títulos privados.
- **Retención:** máximo 30 días para logs ordinarios y presupuesto local de 2 MB, eliminando primero eventos `debug`/`info` antiguos y preservando errores recientes.
- **Exportación:** el botón *Exportar diagnóstico* descarga un archivo JSON local sin subirlo a ningún servicio.

## Modo de recuperación (`/recovery`)

- Ruta independiente (`RecoveryViewComponent`) que no inicializa `KnowledgeStore` ni el editor.
- Muestra versión instalada, esquema local, error o código de diagnóstico, estado de bloqueo entre pestañas y eventos recientes.
- Permite **Reintentar apertura segura** y **Exportar diagnóstico JSON**, sin ofrecer borrado de datos como primera solución.
