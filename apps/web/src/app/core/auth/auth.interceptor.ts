import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.apiUrl || !req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const auth = inject(AuthService);
  return from(auth.getIdToken()).pipe(
    switchMap((token) => {
      if (!token) return next(req);
      const cloned = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      });
      return next(cloned);
    }),
  );
};
