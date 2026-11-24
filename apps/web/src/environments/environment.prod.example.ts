export interface AppEnvironment {
  production: boolean;
  apiUrl: string;
}

export const environment: AppEnvironment = {
  production: true,
  apiUrl: '',
};
