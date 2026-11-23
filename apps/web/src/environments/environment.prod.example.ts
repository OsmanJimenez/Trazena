export interface AppEnvironment {
  production: boolean;
  apiUrl: string;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
  };
}

export const environment: AppEnvironment = {
  production: true,
  apiUrl: '',
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
