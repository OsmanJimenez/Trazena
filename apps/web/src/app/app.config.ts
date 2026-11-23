import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAtralume } from '@osmanjimenez/atralume';
import {
  ATRALUME_BUILTIN_ICONS,
  provideAtralumeIcons,
} from '@osmanjimenez/atralume/icon';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { TRAZENA_ICONS } from './core/icons/trazena-icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAtralume(),
    provideAtralumeIcons([...ATRALUME_BUILTIN_ICONS, ...TRAZENA_ICONS]),
  ],
};
