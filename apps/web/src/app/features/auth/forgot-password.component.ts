import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'trz-forgot-password',
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
              <h1>Recuperar contraseña</h1>
              <p class="auth-subtitle">Recibirás un enlace de restablecimiento en tu correo.</p>
            </div>
          </div>

          @if (sent()) {
            <div class="auth-success" role="status">
              <atr-icon name="check" size="small" />
              <span>Revisa tu bandeja de entrada para restablecer tu contraseña.</span>
            </div>
          } @else {
            <form class="auth-form" (ngSubmit)="submit()">
              <label class="field">
                <span>Correo electrónico</span>
                <input
                  type="email"
                  name="email"
                  required
                  [(ngModel)]="email"
                  placeholder="nombre@dominio.com"
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
                Enviar enlace de recuperación
              </button>
            </form>
          }

          <div class="auth-footer">
            <a routerLink="/login">← Volver a iniciar sesión</a>
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
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .auth-subtitle {
      margin: 0.2rem 0 0;
      color: var(--trz-text-muted);
      font-size: 0.84rem;
      line-height: 1.4;
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

        &:focus {
          border-color: var(--trz-accent);
          box-shadow: 0 0 0 3px var(--trz-accent-soft);
        }
      }
    }

    .auth-error {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.7rem 0.85rem;
      border-radius: var(--trz-radius-sm);
      background: color-mix(in srgb, var(--trz-danger) 10%, transparent);
      color: var(--trz-danger);
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .auth-success {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 0.9rem;
      border-radius: var(--trz-radius-sm);
      background: color-mix(in srgb, var(--trz-success) 12%, transparent);
      color: var(--trz-success);
      font-size: 0.85rem;
    }

    .auth-footer {
      text-align: center;
      padding-top: 0.4rem;
      border-top: 1px solid var(--trz-border);
      font-size: 0.84rem;

      a {
        color: var(--trz-accent);
        text-decoration: none;
        font-weight: 500;
        &:hover { text-decoration: underline; }
      }
    }
  `,
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);

  protected email = '';
  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.errorMessage.set(null);
    this.submitting.set(true);
    try {
      await this.auth.sendPasswordReset(this.email);
      this.sent.set(true);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'No se pudo enviar el enlace.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
