import {
  UrlSegment,
  type Routes,
  type UrlMatchResult,
  type UrlMatcher,
} from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

/**
 * Matches arbitrary hierarchical depth under `/o/:orgSlug/:wsSlug/<pagePath...>`.
 */
export const hierarchyPageMatcher: UrlMatcher = (
  segments: UrlSegment[],
): UrlMatchResult | null => {
  if (segments.length < 3) return null;
  const [orgSeg, wsSeg, ...pageSegs] = segments;
  return {
    consumed: segments,
    posParams: {
      orgSlug: orgSeg,
      wsSlug: wsSeg,
      pagePath: new UrlSegment(
        pageSegs.map((s) => s.path).join('/'),
        {},
      ),
    },
  };
};

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/app-shell.component').then((m) => m.AppShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/home/home-dashboard.component').then(
            (m) => m.HomeDashboardComponent,
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then(
            (m) => m.SettingsComponent,
          ),
      },
      {
        path: 'settings/storage',
        loadComponent: () =>
          import('./features/settings/storage-dashboard.component').then(
            (m) => m.StorageDashboardComponent,
          ),
      },
      {
        path: 'o',
        children: [
          {
            matcher: hierarchyPageMatcher,
            loadComponent: () =>
              import('./features/page/page-view.component').then(
                (m) => m.PageViewComponent,
              ),
          },
          {
            path: ':orgSlug/:wsSlug',
            loadComponent: () =>
              import('./features/workspace/workspace-view.component').then(
                (m) => m.WorkspaceViewComponent,
              ),
          },
          {
            path: ':orgSlug',
            loadComponent: () =>
              import('./features/organization/organization-view.component').then(
                (m) => m.OrganizationViewComponent,
              ),
          },
        ],
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
