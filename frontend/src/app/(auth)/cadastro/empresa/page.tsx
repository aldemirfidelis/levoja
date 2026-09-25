'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isValidCnpj, isValidCpf, isValidEmail, normalizeBrazilianPhone } from '@levoja/shared';
import { session, useApi } from '@levoja/web-kit/client';
import { Button, Checkbox, errorMessage, Input, Select } from '@levoja/web-kit/ui';
import { ConsentFields, Consents, emptyPerson, maskCpf, maskPhone, PersonFields, personBody, validatePerson } from '@/components/signup-fields';

interface Segment {
  id: string;
  name: string;
  kind: 'MARKETPLACE' | 'ON_DEMAND';
  isRegulated: boolean;
}

/** Máscara de CNPJ que também aceita o formato alfanumérico. */
function maskCnpj(value: string) {
  const c = value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  return c
    .replace(/^(\w{2})(\w)/, '$1.$2')
    .replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3')
    .replace(/\.(\w{3})(\w)/, '.$1/$2')
    .replace(/(\w{4})(\w{1,2})$/, '$1-$2');
}

export default function CompanySignupPage() {
  const router = useRouter();
  const { data: segments } = useApi<Segment[]>('segments');
  const [person, setPerson] = useState(emptyPerson);
  const [company, setCompany] = useState({ legalName: '', tradeName: '', cnpj: '', segmentId: '', email: '', phone: '' });
  const [isResponsible, setIsResponsible] = useState(true);
  const [responsible, setResponsible] = useState({ name: '', cpf: '' });
  const [consents, setConsents] = useState<Consents>({ terms: false, marketing: false, extra: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const marketplace = (segments ?? []).filter((segment) => segment.kind === 'MARKETPLACE');
  const selected = marketplace.find((segment) => segment.id === company.segmentId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = { ...validatePerson(person, true) };
    if (company.legalName.trim().length < 3) found.legalName = 'Informe a razão social.';
    if (company.tradeName.trim().length < 2) found.tradeName = 'Informe o nome fantasia.';
    if (!isValidCnpj(company.cnpj)) found.cnpj = 'CNPJ inválido.';
    if (!company.segmentId) found.segmentId = 'Selecione o segmento.';
    if (!isValidEmail(company.email)) found.companyEmail = 'E-mail inválido.';
    if (!normalizeBrazilianPhone(company.phone)) found.companyPhone = 'Telefone inválido.';
    if (!isResponsible) {
      if (responsible.name.trim().length < 3) found.responsibleName = 'Informe o nome do responsável.';
      if (!isValidCpf(responsible.cpf)) found.responsibleCpf = 'CPF inválido.';
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!consents.terms || !consents.extra) return setError('Aceite os Termos de Uso, a Política de Privacidade e os Termos para Empresas.');

    setBusy(true);
    setError(undefined);
    try {
      const result = await session.register<{ companyId: string }>('company', {
        ...personBody(person),
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        marketingOptIn: consents.marketing,
        company: {
          ...company,
          responsibleName: isResponsible ? person.name : responsible.name,
          responsibleCpf: isResponsible ? person.cpf : responsible.cpf,
        },
      });
      router.replace(`/empresa/${result.companyId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-2xl">
      <h1 className="text-2xl font-extrabold text-fg">Cadastrar minha empresa</h1>
      <p className="mt-1 text-sm text-muted">Depois, complete endereço, horários, dados bancários e documentos para análise.</p>
      <form onSubmit={submit} className="mt-6 space-y-6 rounded-2xl border border-border bg-surface p-6" noValidate>
        <fieldset className="space-y-4">
          <legend className="text-base font-bold">Seus dados de acesso</legend>
          <PersonFields form={person} setForm={setPerson} errors={errors} cpfRequired program="COMPANY" />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-base font-bold sm:col-span-2">Dados da empresa</legend>
          <Input label="Razão social" required value={company.legalName} error={errors.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} />
          <Input label="Nome fantasia" required value={company.tradeName} error={errors.tradeName} onChange={(e) => setCompany({ ...company, tradeName: e.target.value })} />
          <Input
            label="CNPJ"
            hint="Aceita CNPJ numérico ou alfanumérico."
            required
            value={company.cnpj}
            error={errors.cnpj}
            onChange={(e) => setCompany({ ...company, cnpj: maskCnpj(e.target.value) })}
          />
          <Select
            label="Segmento"
            required
            value={company.segmentId}
            error={errors.segmentId}
            placeholder="Selecione"
            options={marketplace.map((segment) => ({ value: segment.id, label: segment.name }))}
            onChange={(e) => setCompany({ ...company, segmentId: e.target.value })}
            hint={selected?.isRegulated ? 'Segmento regulado: serão exigidas licenças específicas.' : undefined}
          />
          <Input label="E-mail da empresa" type="email" required value={company.email} error={errors.companyEmail} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
          <Input label="Telefone da empresa" required value={company.phone} error={errors.companyPhone} onChange={(e) => setCompany({ ...company, phone: maskPhone(e.target.value) })} />
          <Checkbox className="sm:col-span-2" label="Sou o responsável legal pela empresa" checked={isResponsible} onChange={(e) => setIsResponsible(e.target.checked)} />
          {!isResponsible && (
            <>
              <Input label="Nome do responsável legal" required value={responsible.name} error={errors.responsibleName} onChange={(e) => setResponsible({ ...responsible, name: e.target.value })} />
              <Input label="CPF do responsável legal" required value={responsible.cpf} error={errors.responsibleCpf} onChange={(e) => setResponsible({ ...responsible, cpf: maskCpf(e.target.value) })} />
            </>
          )}
        </fieldset>

        <ConsentFields
          consents={consents}
          setConsents={setConsents}
          extra={{
            label: (
              <>
                Li e aceito os{' '}
                <Link href="/termos-empresa" target="_blank" className="text-brand-600 underline">
                  Termos para Empresas Parceiras
                </Link>
                .
              </>
            ),
          }}
        />
        {error && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Cadastrar empresa
        </Button>
      </form>
    </div>
  );
}
