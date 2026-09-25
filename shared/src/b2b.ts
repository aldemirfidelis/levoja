/** B2B (entregas corporativas): vocabulário compartilhado entre API, portais e integrações. */

import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, PROOF_METHOD_LABELS, PROOF_OF_DELIVERY_METHODS, type ItemCategory, type ProofOfDeliveryMethod } from './statuses';

export const CONTRACT_STATUS_LABELS = { DRAFT: 'Rascunho', ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', ENDED: 'Encerrado' } as const;
export type ContractStatus = keyof typeof CONTRACT_STATUS_LABELS;

export const INVOICE_STATUS_LABELS = { ISSUED: 'Em aberto', PAID: 'Paga', OVERDUE: 'Vencida', CANCELED: 'Cancelada' } as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS_LABELS;

export const BATCH_STATUS_LABELS = { VALIDATING: 'Validando', READY: 'Pronto para confirmar', CONFIRMED: 'Confirmado', CANCELED: 'Cancelado', FAILED: 'Falhou' } as const;
export type BatchStatus = keyof typeof BATCH_STATUS_LABELS;

export const BATCH_ITEM_STATUS_LABELS = { PENDING: 'Aguardando', VALID: 'Válida', INVALID: 'Com erro', CREATED: 'Entrega criada' } as const;

export const ROUTE_STATUS_LABELS = {
  PLANNED: 'Planejada',
  DISPATCHING: 'Procurando entregador',
  ASSIGNED: 'Com entregador',
  COMPLETED: 'Concluída',
  SPLIT: 'Distribuída individualmente',
  CANCELED: 'Cancelada',
} as const;

/**
 * Escopos das chaves de API das empresas. Cada escopo exige a permissão equivalente de quem criou a
 * chave e o recurso do plano (quando os planos SaaS estão ativos); cada rota declara o escopo que aceita.
 */
export const API_KEY_SCOPES = {
  'deliveries:read': { label: 'Consultar entregas e lotes', permission: 'company.orders.read', feature: 'integrations' },
  'deliveries:write': { label: 'Criar entregas, lotes e cancelar', permission: 'company.deliveries.request', feature: 'integrations' },
  'catalog:read': { label: 'Consultar produtos, preços e estoque', permission: 'company.products.read', feature: 'api' },
  'catalog:write': { label: 'Criar e alterar produtos, preços e estoque', permission: 'company.products.manage', feature: 'api' },
  'orders:read': { label: 'Consultar pedidos', permission: 'company.orders.read', feature: 'api' },
  'orders:write': { label: 'Confirmar, preparar, marcar pronto e cancelar pedidos', permission: 'company.orders.manage', feature: 'api' },
} as const;
export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

// -----------------------------------------------------------------------------
// Importação de lotes (CSV, Excel ou API)
// -----------------------------------------------------------------------------

export interface BatchColumn {
  key: BatchField;
  header: string;
  required: boolean;
  example: string;
  help: string;
  /** Outros nomes aceitos no cabeçalho (sem acento, minúsculas). */
  aliases: string[];
}

export type BatchField =
  | 'externalRef'
  | 'recipientName'
  | 'recipientPhone'
  | 'zipCode'
  | 'street'
  | 'number'
  | 'complement'
  | 'district'
  | 'city'
  | 'state'
  | 'reference'
  | 'lat'
  | 'lng'
  | 'itemCategory'
  | 'itemDescription'
  | 'weightKg'
  | 'declaredValue'
  | 'notes'
  | 'costCenter'
  | 'proofMethod';

export const BATCH_COLUMNS: readonly BatchColumn[] = [
  { key: 'externalRef', header: 'referencia', required: false, example: 'NF-10231', help: 'Seu código (pedido, nota fiscal, protocolo). Aparece nos relatórios e na fatura.', aliases: ['ref', 'pedido', 'nota', 'codigo', 'id'] },
  { key: 'recipientName', header: 'destinatario', required: true, example: 'Maria Souza', help: 'Quem recebe.', aliases: ['nome', 'recebedor', 'cliente'] },
  { key: 'recipientPhone', header: 'telefone', required: false, example: '11987654321', help: 'Celular do destinatário (aviso com o link de acompanhamento).', aliases: ['celular', 'fone', 'whatsapp'] },
  { key: 'zipCode', header: 'cep', required: false, example: '01310100', help: 'Somente números.', aliases: [] },
  { key: 'street', header: 'rua', required: true, example: 'Avenida Paulista', help: 'Logradouro.', aliases: ['logradouro', 'endereco'] },
  { key: 'number', header: 'numero', required: true, example: '1000', help: 'Número (use S/N quando não houver).', aliases: ['num', 'no', 'n'] },
  { key: 'complement', header: 'complemento', required: false, example: 'Sala 12', help: '', aliases: ['compl'] },
  { key: 'district', header: 'bairro', required: false, example: 'Bela Vista', help: '', aliases: [] },
  { key: 'city', header: 'cidade', required: true, example: 'São Paulo', help: '', aliases: ['municipio'] },
  { key: 'state', header: 'uf', required: true, example: 'SP', help: 'Sigla do estado.', aliases: ['estado'] },
  { key: 'reference', header: 'ponto_referencia', required: false, example: 'Portaria B', help: '', aliases: ['referencia_local', 'ponto_de_referencia'] },
  { key: 'lat', header: 'latitude', required: false, example: '-23.5613', help: 'Opcional: evita a busca do endereço no mapa.', aliases: ['lat'] },
  { key: 'lng', header: 'longitude', required: false, example: '-46.6565', help: 'Opcional.', aliases: ['lng', 'lon', 'long'] },
  { key: 'itemCategory', header: 'categoria', required: false, example: 'Documentos', help: `Uma de: ${ITEM_CATEGORIES.map((category) => ITEM_CATEGORY_LABELS[category]).join(', ')}. Padrão: Encomenda.`, aliases: ['tipo'] },
  { key: 'itemDescription', header: 'descricao', required: false, example: 'Contrato assinado', help: 'O que será entregue.', aliases: ['item', 'conteudo'] },
  { key: 'weightKg', header: 'peso_kg', required: false, example: '0,5', help: 'Peso em kg (define o veículo).', aliases: ['peso'] },
  { key: 'declaredValue', header: 'valor_declarado', required: false, example: '150,00', help: 'Em reais.', aliases: ['valor'] },
  { key: 'notes', header: 'observacoes', required: false, example: 'Entregar na recepção', help: 'Instruções para o entregador.', aliases: ['obs', 'observacao', 'instrucoes'] },
  { key: 'costCenter', header: 'centro_custo', required: false, example: 'MKT', help: 'Código do centro de custo cadastrado.', aliases: ['centro_de_custo', 'cc'] },
  { key: 'proofMethod', header: 'comprovacao', required: false, example: 'Assinatura digital', help: `Uma de: ${PROOF_OF_DELIVERY_METHODS.map((method) => PROOF_METHOD_LABELS[method]).join(', ')}. Documentos usam assinatura por padrão.`, aliases: ['prova', 'comprovante'] },
];

/** Normaliza textos para comparação (sem acentos, minúsculas, espaços viram "_"). */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Coluna do lote correspondente a um cabeçalho da planilha (ou null se não reconhecida). */
export function matchBatchColumn(header: string): BatchField | null {
  const key = normalizeKey(header);
  const column = BATCH_COLUMNS.find((item) => item.header === key || item.aliases.includes(key) || normalizeKey(item.key) === key);
  return column?.key ?? null;
}

/** Categoria a partir do código (PACKAGE) ou do rótulo (Encomenda). */
export function parseItemCategory(value: string | undefined | null): ItemCategory | null {
  if (!value?.trim()) return null;
  const key = normalizeKey(value);
  return ITEM_CATEGORIES.find((category) => normalizeKey(category) === key || normalizeKey(ITEM_CATEGORY_LABELS[category]) === key) ?? null;
}

/** Comprovação a partir do código (SIGNATURE) ou do rótulo (Assinatura digital / assinatura). */
export function parseProofMethod(value: string | undefined | null): ProofOfDeliveryMethod | null {
  if (!value?.trim()) return null;
  const key = normalizeKey(value);
  const short: Record<string, ProofOfDeliveryMethod> = { codigo: 'CODE', assinatura: 'SIGNATURE', foto: 'PHOTO', qr: 'QR_CODE', qrcode: 'QR_CODE' };
  return PROOF_OF_DELIVERY_METHODS.find((method) => normalizeKey(method) === key || normalizeKey(PROOF_METHOD_LABELS[method]) === key) ?? short[key] ?? null;
}

/** Número no formato brasileiro ("1.234,56") ou internacional ("1234.56"). */
export function parseDecimal(value: string | number | undefined | null): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = value.trim().replace(/\s|R\$/gi, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
