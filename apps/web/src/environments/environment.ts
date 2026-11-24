export interface AppEnvironment {
  production: boolean;
  /** Base URL of Cloudflare Workers API (e.g. 'https://trazena-api.<subdomain>.workers.dev'). Leave empty for offline-first Local Vault mode. */
  apiUrl: string;
}

export const environment: AppEnvironment = {
  production: false,
  apiUrl: '',
};
