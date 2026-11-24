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
        <div class="auth-inner">
          <div class="auth-brand">
            <div class="auth-logo">T</div>
            <div>
              <h1>Trazena</h1>
              <p class="auth-subtitle">Tu espacio de conocimiento jerárquico</p>
            </div>
          </div>

          @if (!auth.isRemoteApiEnabled) {
            <div class="auth-notice" role="status">
              <atr-icon name="info" size="small" />
              <span>
                <strong>Modo bóveda local (IndexedDB):</strong> sin servidor API configurado; ingresa para trabajar offline-first.
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
                placeholder="nombre@dominio.com"
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
                placeholder="Tu contraseña"
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
              Continuar
            </button>
          </form>

          <div class="auth-footer">
            <a routerLink="/forgot-password">¿Olvidaste tu contraseña?</a>
            <span class="auth-hint">Acceso privado · Sin registro público</span>
          </div>
        </div>
      </atr-card>
    </main>
  `,
  styles: `
    .auth-page {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 1.5rem 1rem;
      background:
        radial-gradient(600px circle at 50% 0%, var(--trz-accent-soft), transparent 65%),
        var(--trz-bg-sidebar);
    }

    .auth-card {
      width: 100%;
      max-width: 400px;
      box-shadow: var(--trz-shadow-md) !important;
    }

    .auth-inner {
      padding: 2rem 1.75rem;
      display: flex;
      flex-direction: column;
      gap: 1.35rem;
    }

    .auth-brand {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }

    .auth-logo {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--trz-text);
      color: var(--trz-bg);
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 1.15rem;
      flex-shrink: 0;
    }

    h1 {
      margin: 0;
      font-size: 1.3rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--trz-text);
    }

    .auth-subtitle {
      margin: 0.15rem 0 0;
      color: var(--trz-text-muted);
      font-size: 0.85rem;
    }

    .auth-notice {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      padding: 0.7rem 0.85rem;
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle);
      border: 1px solid var(--trz-border);
      color: var(--trz-text-muted);
      font-size: 0.8rem;
      line-height: 1.45;
    }

    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 0.95rem;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--trz-text);

      input {
        width: 100%;
        padding: 0.62rem 0.8rem;
        border: 1px solid var(--trz-border-strong);
        border-radius: var(--trz-radius-sm);
        background: var(--trz-bg);
        color: var(--trz-text);
        font: inherit;
        font-size: 0.9rem;
        outline: none;
        transition: border-color 140ms ease, box-shadow 140ms ease;

        &:focus {
          border-color: var(--trz-accent);
          box-shadow: 0 0 0 3px var(--trz-accent-soft);
        }
      }
    }

    .auth-error {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 0.8rem;
      border-radius: var(--trz-radius-sm);
      background: color-mix(in srgb, var(--trz-danger) 10%, transparent);
      color: var(--trz-danger);
      font-size: 0.82rem;
    }

    .auth-footer {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
      padding-top: 0.4rem;
      border-top: 1px solid var(--trz-border);
      font-size: 0.82rem;

      a {
        color: var(--trz-accent);
        text-decoration: none;
        font-weight: 500;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    .auth-hint {
      color: var(--trz-text-subtle);
      font-size: 0.76rem;
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
