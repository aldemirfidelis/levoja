'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, isValidCpf, isValidEmail, normalizeBrazilianPhone, normalizeReferralCode, passwordIssues, type ReferralProgram } from '@levoja/shared';
import { api } from '@levoja/web-kit/client';
import { Checkbox, Input } from '@levoja/web-kit/ui';

export interface PersonForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  cpf: string;
  /** Código de quem indicou (opcional). */
  referralCode: string;
}

export const emptyPerson: PersonForm = { name: '', email: '', phone: '', password: '', cpf: '', referralCode: '' };

/** Corpo do cadastro: código de indicação vazio não é enviado. */
export function personBody(form: PersonForm) {
  const { referralCode, ...rest } = form;
  return { ...rest, referralCode: normalizeReferralCode(referralCode) || undefined };
}

interface ReferralCheck {
  valid: boolean;
  reason?: string;
  referredRewardCents?: number;
  goal?: string;
}

/** Código de indicação: pré-preenchido pelo link de convite (?indicacao=) e conferido enquanto digita. */
export function ReferralField({ value, onChange, program }: { value: string; onChange: (value: string) => void; program: ReferralProgram }) {
  const [check, setCheck] = useState<ReferralCheck | null>(null);
  const code = normalizeReferralCode(value);
  useEffect(() => {
    setCheck(null);
    if (code.length < 4) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<ReferralCheck>('referrals/validate', { code, program }, controller.signal)
        .then(setCheck)
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, program]);
  const hint = check?.valid
    ? `Código aplicado${check.referredRewardCents ? `: você ganha ${formatBRL(check.referredRewardCents)}` : ''}${check.goal ? ` (${check.goal.charAt(0).toLowerCase()}${check.goal.slice(1)})` : ''}.`
    : 'Opcional. Recebeu um convite? Informe o código de quem indicou.';
  return (
    <Input
      label="Código de indicação (opcional)"
      value={value}
      maxLength={20}
      autoComplete="off"
      hint={hint}
      error={check && !check.valid ? (check.reason ?? 'Código não encontrado.') : undefined}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
    />
  );
}

/** Validação no cliente (feedback imediato). A API revalida tudo. */
export function validatePerson(form: PersonForm, cpfRequired: boolean): Partial<Record<keyof PersonForm, string>> {
  const errors: Partial<Record<keyof PersonForm, string>> = {};
  if (form.name.trim().length < 3) errors.name = 'Informe seu nome completo.';
  if (!isValidEmail(form.email)) errors.email = 'E-mail inválido.';
  if (!normalizeBrazilianPhone(form.phone)) errors.phone = 'Celular inválido. Informe DDD + número.';
  const issues = passwordIssues(form.password);
  if (issues.length) errors.password = issues[0];
  if ((cpfRequired || form.cpf) && !isValidCpf(form.cpf)) errors.cpf = 'CPF inválido.';
  return errors;
}

import { maskCpf, maskPhone } from '@levoja/shared';

export { maskCpf, maskPhone };

export function PersonFields({
  form,
  setForm,
  errors,
  cpfRequired,
  program,
}: {
  form: PersonForm;
  setForm: (form: PersonForm) => void;
  errors: Partial<Record<keyof PersonForm, string>>;
  cpfRequired: boolean;
  /** Programa de indicação deste cadastro (mostra o campo de código). */
  program?: ReferralProgram;
}) {
  // Link de convite: /cadastro/...?indicacao=CODIGO
  useEffect(() => {
    const invited = new URLSearchParams(window.location.search).get('indicacao');
    if (program && invited && !form.referralCode) setForm({ ...form, referralCode: invited.toUpperCase() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input className="sm:col-span-2" label="Nome completo" autoComplete="name" required value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input label="E-mail" type="email" autoComplete="email" required value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <Input label="Celular" type="tel" autoComplete="tel" required value={form.phone} error={errors.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
      <Input
        label={cpfRequired ? 'CPF' : 'CPF (opcional)'}
        inputMode="numeric"
        required={cpfRequired}
        value={form.cpf}
        error={errors.cpf}
        onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })}
      />
      <Input
        label="Senha"
        type="password"
        autoComplete="new-password"
        hint="Mínimo de 8 caracteres, com letras e números."
        required
        value={form.password}
        error={errors.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      {program && (
        <div className="sm:col-span-2">
          <ReferralField program={program} value={form.referralCode} onChange={(referralCode) => setForm({ ...form, referralCode })} />
        </div>
      )}
    </div>
  );
}

export interface Consents {
  terms: boolean;
  marketing: boolean;
  extra: boolean;
}

export function ConsentFields({
  consents,
  setConsents,
  extra,
}: {
  consents: Consents;
  setConsents: (consents: Consents) => void;
  extra?: { label: React.ReactNode };
}) {
  return (
    <div className="space-y-3 rounded-xl bg-surface-2 p-4">
      <Checkbox
        checked={consents.terms}
        onChange={(e) => setConsents({ ...consents, terms: e.target.checked })}
        label={
          <>
            Li e aceito os{' '}
            <Link href="/termos" target="_blank" className="text-brand-600 underline">
              Termos de Uso
            </Link>{' '}
            e a{' '}
            <Link href="/privacidade" target="_blank" className="text-brand-600 underline">
              Política de Privacidade
            </Link>
            .
          </>
        }
      />
      {extra && <Checkbox checked={consents.extra} onChange={(e) => setConsents({ ...consents, extra: e.target.checked })} label={extra.label} />}
      <Checkbox
        checked={consents.marketing}
        onChange={(e) => setConsents({ ...consents, marketing: e.target.checked })}
        label="Quero receber ofertas e novidades por e-mail e notificações (opcional)."
      />
    </div>
  );
}
