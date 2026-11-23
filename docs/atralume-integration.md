# Integración con Atralume (`@osmanjimenez/atralume`)

## Principios de consumo

- Trazena consume `@osmanjimenez/atralume` directamente desde npm (sin symlinks ni rutas relativas locales).
- Ningún modelo de negocio de Trazena (`Organization`, `Workspace`, `Page`, `Tag`, `SavedView`, etc.) existe dentro de Atralume.

## Componentes utilizados en Trazena

- `AtralumeButton` (`atrButton`) y `AtralumeIconButton` (`atrIconButton`)
- `AtralumeIcon` (`atr-icon`) con `provideAtralumeIcons([...ATRALUME_BUILTIN_ICONS, ...TRAZENA_ICONS])`
- `AtralumeDialog` (`AtralumeDialogTitle`, `AtralumeDialogContent`, `AtralumeDialogActions`) para modales de confirmación, entrada de texto, búsqueda rápida (`Ctrl+K`) y exportación multiformato
- `AtralumeCard` (`atr-card`)
- `AtralumeEmptyState` (`atr-empty-state`)
- `AtralumeSnackbar` para notificaciones no bloqueantes

## Convenciones técnicas en Trazena

- Los modales abiertos mediante `AtralumeDialog` usan `closable: false` y renderizan su propio botón `<button atrIconButton><atr-icon name="close" size="small" /></button>` para garantizar coherencia visual y evitar solicitudes a SVGs externos no empaquetados.
- El tema claro/oscuro sincroniza la clase del documento y las variables CSS `--trz-*` con los tokens visuales de Atralume en un solo clic (`ThemeService.toggleTheme()`).
