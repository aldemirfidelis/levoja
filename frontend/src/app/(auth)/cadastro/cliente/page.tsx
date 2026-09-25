'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { session } from '@levoja/web-kit/client';
import { Button, errorMessage } from '@levoja/web-kit/ui';
import { ConsentFields, Consents, emptyPerson, PersonFields, personBody, validatePerson } from '@/components/signup-fields';

export default function CustomerSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState(emptyPerson);
  const [consents, setConsents] = useState<Consents>({ terms: false, marketing: false, extra: false });
  const [errors, setErrors] = useState<ReturnType<typeof validatePerson>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validatePerson(form, false);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!consents.terms) return setError('É necessário aceitar os Termos de Uso e a Política de Privacidade.');
    setBusy(true);
    setError(undefined);
    try {
      await session.register('customer', {
        ...personBody(form),
        cpf: form.cpf || undefined,
        acceptTerms: true,
        acceptPrivacy: true,
        marketingOptIn: consents.marketing,
      });
      router.replace('/conta?bemvindo=1');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-xl">
      <h1 className="text-2xl font-extrabold text-fg">Criar conta de cliente</h1>
      <p className="mt-1 text-sm text-muted">Leva menos de um minuto.</p>
      <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-border bg-surface p-6" noValidate>
        <PersonFields form={form} setForm={setForm} errors={errors} cpfRequired={false} program="CUSTOMER" />
        <ConsentFields consents={consents} setConsents={setConsents} />
        {error && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Criar conta
        </Button>
        <p className="text-center text-sm text-muted">
          Já tem conta?{' '}
          <Link href="/entrar" className="font-medium text-brand-600 hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </div>
  );
}
