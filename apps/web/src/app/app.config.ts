import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideAtralume } from '@osmanjimenez/atralume';
import { AtralumeDialog } from '@osmanjimenez/atralume/dialog';
import {
  ATRALUME_BUILTIN_ICONS,
  provideAtralumeIcons,
} from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { TRAZENA_ICONS } from './core/icons/trazena-icons';
import {
  TrazenaFastDialogService,
  TrazenaSnackbarService,
} from './core/ui/trazena-overlays';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAtralume(),
    provideAtralumeIcons([...ATRALUME_BUILTIN_ICONS, ...TRAZENA_ICONS]),
    { provide: AtralumeSnackbar, useClass: TrazenaSnackbarService },
    { provide: AtralumeDialog, useClass: TrazenaFastDialogService },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
