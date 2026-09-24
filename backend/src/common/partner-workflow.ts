import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PARTNER_ACTION_LABELS, PARTNER_STATUS_LABELS, PartnerAction, partnerTransition, PartnerStatus } from '@levoja/shared';
import type { AuthUser } from './auth/auth-user';

export interface WorkflowPermissions {
  review: string;
  manage: string;
}

/**
 * Valida uma ação administrativa sobre o cadastro de um parceiro (empresa/entregador)
 * e retorna o novo status. Regras:
 * - REVIEWER (aprovar, reprovar, solicitar correção) exige a permissão de revisão;
 * - MANAGER (suspender, bloquear, reativar) exige a permissão de gestão;
 * - ações que exigem justificativa precisam de `reason`.
 */
export function resolveAdminTransition(
  actor: AuthUser,
  action: PartnerAction,
  current: PartnerStatus,
  reason: string | undefined,
  permissions: WorkflowPermissions,
): PartnerStatus {
  const transition = partnerTransition(action, current);
  if (!transition) {
    throw new ConflictException(
      `Não é possível "${PARTNER_ACTION_LABELS[action].toLowerCase()}" um cadastro com status "${PARTNER_STATUS_LABELS[current]}".`,
    );
  }
  if (transition.actor === 'OWNER') throw new BadRequestException('Ação disponível apenas para o titular do cadastro.');
  const required = transition.actor === 'REVIEWER' ? permissions.review : permissions.manage;
  if (!actor.can(required)) throw new ForbiddenException('Você não tem permissão para esta ação.');
  if (transition.requiresReason && !reason?.trim()) throw new BadRequestException('Informe o motivo.');
  return transition.to;
}

export function resolveOwnerSubmit(current: PartnerStatus): PartnerStatus {
  const transition = partnerTransition('SUBMIT', current);
  if (!transition) {
    throw new ConflictException(`Cadastro com status "${PARTNER_STATUS_LABELS[current]}" não pode ser enviado para análise.`);
  }
  return transition.to;
}

export interface RequirementItem {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
}

export function assertRequirements(items: RequirementItem[]): void {
  const missing = items.filter((item) => !item.done);
  if (missing.length) {
    throw new BadRequestException({
      message: 'Cadastro incompleto. Conclua as pendências antes de enviar para análise.',
      details: missing.map((item) => item.label),
    });
  }
}

/** Gera slug legível a partir de um nome. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'empresa';
}
