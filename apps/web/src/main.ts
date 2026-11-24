import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Safe UUID fallback for older mobile browsers or non-HTTPS LAN previews
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as unknown as { randomUUID: () => string }).randomUUID = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
