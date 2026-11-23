import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'trz-login',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton, AtralumeCard, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <atr-card appearance="elevated" class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo">T</div>
          <div>
            <h1>Trazena</h1>
            <p class="auth-subtitle">Base de conocimiento jerárquica</p>
          </div>
        </div>

        @if (!auth.isFirebaseConfigured) {
          <div class="auth-notice" role="status">
            <atr-icon name="info" size="small" />
            <span>
              <strong>Modo local offline-first:</strong> Firebase aún no está configurado en
              <code>environment.ts</code>. Inicia sesión con cualquier correo para usar la bóveda IndexedDB local.
            </span>
          </div>
        }

        <form class="auth-form" (ngSubmit)="submit()">
          <label class="field">
            <span>Correo electrónico</span>
            <input
              type="email"
              name="email"
              autocomplete="email"
              required
              [(ngModel)]="email"
              placeholder="tu@correo.com"
            />
          </label>

          <label class="field">
            <span>Contraseña</span>
            <input
              type="password"
              name="password"
              autocomplete="current-password"
              required
              [(ngModel)]="password"
              placeholder="••••••••"
            />
          </label>

          @if (errorMessage()) {
            <div class="auth-error" role="alert">
              <atr-icon name="warning" size="small" />
              <span>{{ errorMessage() }}</span>
            </div>
          }

          <button
            atrButton
            type="submit"
            appearance="filled"
            [fullWidth]="true"
            [loading]="submitting()"
          >
            Iniciar sesión
          </button>
        </form>

        <div class="auth-footer">
          <a routerLink="/forgot-password">¿Olvidaste tu contraseña?</a>
          <span class="auth-hint">Acceso privado — sin registro público</span>
        </div>
      </atr-card>
    </main>
  `,
  styles: `
    .auth-page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      background:
        radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--trz-accent) 10%, transparent), transparent 45%),
        var(--trz-bg);
    }

    .auth-card {
      width: 100%;
      max-width: 420px;
      padding: 2rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-lg);
      background: var(--trz-bg-elevated);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .auth-brand {
      display: flex;
      align-items: center;
      gap: 0.9rem;
    }

    .auth-logo {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: var(--trz-text);
      color: var(--trz-bg);
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 1.2rem;
      flex-shrink: 0;
    }

    h1 {
      margin: 0;
      font-size: 1.35rem;
      letter-spacing: -0.02em;
    }

    .auth-subtitle {
      margin: 0.15rem 0 0;
      color: var(--trz-text-muted);
      font-size: 0.875rem;
    }

    .auth-notice {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      padding: 0.75rem 0.9rem;
      border-radius: var(--trz-radius-sm);
      background: var(--trz-accent-soft);
      color: var(--trz-text);
      font-size: 0.8125rem;
      line-height: 1.45;
    }

    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--trz-text);

      input {
        width: 100%;
        padding: 0.65rem 0.8rem;
        border: 1px solid var(--trz-border-strong);
        border-radius: var(--trz-radius-sm);
        background: var(--trz-bg);
        color: var(--trz-text);
        font: inherit;
        outline: none;
        transition: border-color 140ms ease;

        &:focus {
          border-color: var(--trz-accent);
        }
      }
    }

    .auth-error {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 0.8rem;
      border-radius: var(--trz-radius-sm);
      background: color-mix(in srgb, var(--trz-danger) 12%, transparent);
      color: var(--trz-danger);
      font-size: 0.83rem;
    }

    .auth-footer {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.82rem;

      a {
        color: var(--trz-accent);
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    .auth-hint {
      color: var(--trz-text-subtle);
      font-size: 0.78rem;
    }
  `,
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected email = '';
  protected password = '';
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.errorMessage.set(null);
    this.submitting.set(true);
    try {
      await this.auth.login(this.email, this.password);
      const redirect = this.route.snapshot.queryParamMap.get('redirect') || '/';
      await this.router.navigateByUrl(redirect);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Error al iniciar sesión.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
