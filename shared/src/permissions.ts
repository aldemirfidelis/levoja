/**
 * Catálogo de permissões da plataforma (RBAC granular).
 *
 * A chave de cada permissão é estável e é gravada no banco pelo seed.
 * Papéis (roles) são configuráveis pelo administrador; os papéis de sistema
 * abaixo são apenas o estado inicial.
 */

export type PermissionScope = 'PLATFORM' | 'COMPANY';

export interface PermissionDefinition {
  key: string;
  group: string;
  description: string;
  scope: PermissionScope;
}

const p = (key: string, group: string, description: string, scope: PermissionScope = 'PLATFORM'): PermissionDefinition => ({
  key,
  group,
  description,
  scope,
});

export const PERMISSIONS = [
  // --- Cliente (autoatendimento) ---
  p('customer.orders.read', 'Cliente', 'Visualizar os próprios pedidos'),
  p('customer.orders.create', 'Cliente', 'Criar pedidos'),
  p('customer.orders.cancel', 'Cliente', 'Cancelar os próprios pedidos'),
  p('customer.deliveries.request', 'Cliente', 'Solicitar entregas avulsas'),
  p('customer.reviews.write', 'Cliente', 'Avaliar pedidos e entregas'),
  p('customer.support.use', 'Cliente', 'Abrir chamados de suporte'),

  // --- Entregador (autoatendimento) ---
  p('driver.deliveries.work', 'Entregador', 'Ficar online, receber e executar entregas'),
  p('driver.earnings.read', 'Entregador', 'Visualizar ganhos e carteira'),
  p('driver.wallet.withdraw', 'Entregador', 'Solicitar saques'),
  p('driver.reviews.write', 'Entregador', 'Avaliar empresas/clientes'),
  p('driver.support.use', 'Entregador', 'Abrir chamados de suporte'),

  // --- Empresa (escopo da empresa) ---
  p('company.profile.manage', 'Empresa', 'Editar dados, horários e documentos da empresa', 'COMPANY'),
  p('company.users.manage', 'Empresa', 'Gerenciar membros da equipe da empresa', 'COMPANY'),
  p('company.products.read', 'Empresa', 'Visualizar catálogo', 'COMPANY'),
  p('company.products.manage', 'Empresa', 'Gerenciar produtos, estoque e promoções', 'COMPANY'),
  p('company.orders.read', 'Empresa', 'Visualizar pedidos', 'COMPANY'),
  p('company.orders.manage', 'Empresa', 'Aceitar, preparar e cancelar pedidos', 'COMPANY'),
  p('company.deliveries.request', 'Empresa', 'Solicitar entregas avulsas e em lote', 'COMPANY'),
  p('company.fleet.manage', 'Empresa', 'Gerenciar frota própria', 'COMPANY'),
  p('company.finance.read', 'Empresa', 'Visualizar financeiro e repasses', 'COMPANY'),
  p('company.finance.withdraw', 'Empresa', 'Solicitar saques do saldo da empresa', 'COMPANY'),
  p('company.reports.read', 'Empresa', 'Visualizar relatórios e indicadores', 'COMPANY'),
  p('company.reviews.write', 'Empresa', 'Avaliar entregadores', 'COMPANY'),
  p('company.support.use', 'Empresa', 'Abrir chamados de suporte', 'COMPANY'),
  p('company.b2b.manage', 'Empresa', 'Gerenciar centros de custo, unidades, entregas recorrentes e chaves de API', 'COMPANY'),

  // --- Plataforma: usuários e acesso ---
  p('users.read', 'Usuários', 'Visualizar usuários'),
  p('users.create', 'Usuários', 'Criar usuários internos'),
  p('users.update', 'Usuários', 'Editar usuários'),
  p('users.status.manage', 'Usuários', 'Bloquear, suspender, desativar e reativar usuários'),
  p('roles.read', 'Acesso', 'Visualizar papéis e permissões'),
  p('roles.manage', 'Acesso', 'Criar/editar papéis e atribuir papéis a usuários'),

  // --- Plataforma: cadastros ---
  p('customers.read', 'Clientes', 'Visualizar clientes'),
  p('companies.read', 'Empresas', 'Visualizar empresas'),
  p('companies.review', 'Empresas', 'Aprovar, reprovar e solicitar documentação de empresas'),
  p('companies.manage', 'Empresas', 'Suspender, bloquear e editar empresas'),
  p('drivers.read', 'Entregadores', 'Visualizar entregadores'),
  p('drivers.review', 'Entregadores', 'Aprovar, reprovar e solicitar correção de entregadores'),
  p('drivers.manage', 'Entregadores', 'Suspender, bloquear e editar entregadores'),
  p('documents.read', 'Documentos', 'Visualizar documentos enviados (dados sensíveis)'),

  // --- Plataforma: operação ---
  p('orders.read', 'Operação', 'Visualizar todos os pedidos'),
  p('orders.manage', 'Operação', 'Intervir em pedidos (cancelar, alterar status)'),
  p('deliveries.read', 'Operação', 'Visualizar todas as entregas'),
  p('deliveries.manage', 'Operação', 'Reatribuir, cancelar e intervir em entregas'),
  p('operations.view', 'Operação', 'Acessar a torre de controle'),
  p('service_areas.manage', 'Operação', 'Gerenciar regiões e áreas de atendimento'),

  // --- Plataforma: financeiro ---
  p('pricing.read', 'Financeiro', 'Visualizar regras de preço'),
  p('pricing.manage', 'Financeiro', 'Alterar regras de preço e comissionamento'),
  p('payments.read', 'Financeiro', 'Visualizar pagamentos e transações'),
  p('payments.manage', 'Financeiro', 'Estornar e conciliar pagamentos'),
  p('payouts.read', 'Financeiro', 'Visualizar saques e repasses'),
  p('payouts.manage', 'Financeiro', 'Aprovar e processar saques e repasses'),
  p('finance.reports', 'Financeiro', 'Relatórios financeiros'),
  p('contracts.read', 'B2B', 'Visualizar contratos corporativos'),
  p('contracts.manage', 'B2B', 'Criar, ativar e encerrar contratos e tabelas especiais'),
  p('invoices.read', 'B2B', 'Visualizar faturas corporativas'),
  p('invoices.manage', 'B2B', 'Emitir, baixar e cancelar faturas'),

  // --- Plataforma: comercial / relacionamento ---
  p('coupons.manage', 'Comercial', 'Gerenciar cupons e campanhas'),
  p('plans.manage', 'Comercial', 'Gerenciar planos SaaS'),
  p('reviews.moderate', 'Comercial', 'Moderar avaliações'),
  p('notifications.broadcast', 'Comercial', 'Enviar comunicados'),
  p('support.tickets.read', 'Suporte', 'Visualizar chamados'),
  p('support.tickets.manage', 'Suporte', 'Atender e encerrar chamados'),

  // --- Plataforma: governança ---
  p('reports.read', 'Governança', 'Acessar relatórios gerenciais (BI)'),
  p('audit.read', 'Governança', 'Visualizar trilha de auditoria'),
  p('settings.manage', 'Governança', 'Configurações da plataforma, segmentos e documentos legais'),
  p('privacy.manage', 'Governança', 'Atender solicitações LGPD'),
  p('fraud.read', 'Governança', 'Visualizar alertas de risco'),
  p('fraud.manage', 'Governança', 'Tratar alertas e regras antifraude'),
  p('tenants.manage', 'Governança', 'Gerenciar tenants (multi-tenant / white label)'),
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((perm) => perm.key);

/** Chaves dos papéis de sistema criados pelo seed. */
export const ROLE_KEYS = {
  CUSTOMER: 'customer',
  DRIVER: 'driver',
  OPERATOR: 'operator',
  SUPPORT: 'support',
  FINANCE: 'finance',
  MANAGER: 'manager',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
  COMPANY_OWNER: 'company_owner',
  COMPANY_MANAGER: 'company_manager',
  COMPANY_ATTENDANT: 'company_attendant',
  COMPANY_FINANCE: 'company_finance',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  scope: PermissionScope;
  /** Papéis internos (staff) acessam o painel administrativo. */
  isStaff: boolean;
  permissions: readonly PermissionKey[] | 'ALL' | 'ALL_EXCEPT_TENANTS';
}

const byPrefix = (...prefixes: string[]): PermissionKey[] =>
  PERMISSION_KEYS.filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    key: 'customer',
    name: 'Cliente',
    description: 'Consumidor final da plataforma',
    scope: 'PLATFORM',
    isStaff: false,
    permissions: byPrefix('customer.'),
  },
  {
    key: 'driver',
    name: 'Entregador',
    description: 'Entregador parceiro (independente ou de frota própria)',
    scope: 'PLATFORM',
    isStaff: false,
    permissions: byPrefix('driver.'),
  },
  {
    key: 'operator',
    name: 'Operador',
    description: 'Operação logística e torre de controle',
    scope: 'PLATFORM',
    isStaff: true,
    permissions: [
      'orders.read',
      'orders.manage',
      'deliveries.read',
      'deliveries.manage',
      'operations.view',
      'companies.read',
      'drivers.read',
      'customers.read',
      'support.tickets.read',
      'pricing.read',
    ],
  },
  {
    key: 'support',
    name: 'Suporte',
    description: 'Central de atendimento',
    scope: 'PLATFORM',
    isStaff: true,
    permissions: [
      'support.tickets.read',
      'support.tickets.manage',
      'orders.read',
      'deliveries.read',
      'users.read',
      'customers.read',
      'companies.read',
      'drivers.read',
    ],
  },
  {
    key: 'finance',
    name: 'Financeiro',
    description: 'Pagamentos, repasses, saques e conciliação',
    scope: 'PLATFORM',
    isStaff: true,
    permissions: [
      'payments.read',
      'payments.manage',
      'payouts.read',
      'payouts.manage',
      'finance.reports',
      'pricing.read',
      'orders.read',
      'companies.read',
      'drivers.read',
      'reports.read',
      'contracts.read',
      'invoices.read',
      'invoices.manage',
    ],
  },
  {
    key: 'manager',
    name: 'Gestor',
    description: 'Gestão operacional e comercial',
    scope: 'PLATFORM',
    isStaff: true,
    permissions: [
      ...byPrefix('companies.', 'drivers.', 'orders.', 'deliveries.', 'support.'),
      'users.read',
      'customers.read',
      'documents.read',
      'operations.view',
      'service_areas.manage',
      'pricing.read',
      'payments.read',
      'payouts.read',
      'finance.reports',
      'coupons.manage',
      'reviews.moderate',
      'reports.read',
      'audit.read',
      'fraud.read',
      'contracts.read',
      'contracts.manage',
      'invoices.read',
    ],
  },
  {
    key: 'admin',
    name: 'Administrador',
    description: 'Administração completa da plataforma (exceto tenants)',
    scope: 'PLATFORM',
    isStaff: true,
    permissions: 'ALL_EXCEPT_TENANTS',
  },
  {
    key: 'super_admin',
    name: 'Super Admin',
    description: 'Acesso total, incluindo multi-tenant',
    scope: 'PLATFORM',
    isStaff: true,
    permissions: 'ALL',
  },
  {
    key: 'company_owner',
    name: 'Proprietário da empresa',
    description: 'Responsável legal pela empresa',
    scope: 'COMPANY',
    isStaff: false,
    permissions: byPrefix('company.'),
  },
  {
    key: 'company_manager',
    name: 'Gerente da empresa',
    description: 'Gerencia catálogo, pedidos e entregas',
    scope: 'COMPANY',
    isStaff: false,
    // Saques ficam com o proprietário e o financeiro da empresa.
    permissions: byPrefix('company.').filter((key) => key !== 'company.users.manage' && key !== 'company.finance.withdraw'),
  },
  {
    key: 'company_attendant',
    name: 'Atendente',
    description: 'Opera pedidos no dia a dia',
    scope: 'COMPANY',
    isStaff: false,
    permissions: [
      'company.products.read',
      'company.orders.read',
      'company.orders.manage',
      'company.deliveries.request',
      'company.reviews.write',
      'company.support.use',
    ],
  },
  {
    key: 'company_finance',
    name: 'Financeiro da empresa',
    description: 'Acompanha faturamento e repasses',
    scope: 'COMPANY',
    isStaff: false,
    permissions: ['company.finance.read', 'company.finance.withdraw', 'company.reports.read', 'company.orders.read', 'company.support.use'],
  },
];

const isSelfService = (key: string) => key.startsWith('customer.') || key.startsWith('driver.');

/**
 * Expande a definição de um papel na lista concreta de permissões.
 * Papéis "ALL" recebem todas as permissões administrativas do seu escopo;
 * permissões de autoatendimento (cliente/entregador) dependem do perfil, não do cargo.
 */
export function resolveRolePermissions(role: RoleDefinition): PermissionKey[] {
  if (role.permissions === 'ALL' || role.permissions === 'ALL_EXCEPT_TENANTS') {
    const excludeTenants = role.permissions === 'ALL_EXCEPT_TENANTS';
    return PERMISSIONS.filter(
      (perm) =>
        perm.scope === role.scope && !isSelfService(perm.key) && !(excludeTenants && perm.key === 'tenants.manage'),
    ).map((perm) => perm.key);
  }
  return [...role.permissions];
}
