export interface AppEnvironment {
  production: boolean;
  /** Base URL of Cloudflare Workers API (e.g. 'http://127.0.0.1:8787' or 'https://trazena-api.workers.dev'). Leave empty for offline-first Local Vault mode. */
  apiUrl: string;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
  };
}

export const environment: AppEnvironment = {
  production: false,
  apiUrl: '',
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
