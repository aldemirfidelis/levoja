/** Aplicativo em execução: define o perfil de login, o registro de push e o armazenamento de sessão. */
export type AppKind = 'CUSTOMER' | 'DRIVER';

export interface KitConfig {
  app: AppKind;
  /** URL base da API, sem o prefixo de versão (ex.: https://api.levoja.com.br). */
  apiUrl: string;
  /** Portal web (links de termos, privacidade e redefinição de senha). */
  webUrl: string;
  /** Tenant (white label) enviado no cabeçalho X-Tenant. */
  tenant?: string;
  /** Tiles do mapa (padrão OpenStreetMap). */
  mapTilesUrl?: string;
  mapAttribution?: string;
}

let current: KitConfig | null = null;

/** Deve ser chamado uma única vez, no módulo raiz do app, antes de qualquer requisição. */
export function configureKit(config: KitConfig): void {
  if (!config.apiUrl) throw new Error('EXPO_PUBLIC_API_URL não configurada.');
  current = { ...config, apiUrl: config.apiUrl.replace(/\/+$/, ''), webUrl: config.webUrl.replace(/\/+$/, '') };
}

export function kitConfig(): KitConfig {
  if (!current) throw new Error('configureKit() não foi chamado.');
  return current;
}
