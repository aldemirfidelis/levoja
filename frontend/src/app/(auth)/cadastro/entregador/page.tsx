'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAdult, VEHICLE_TYPE_LABELS, VEHICLE_TYPES, VehicleType } from '@levoja/shared';
import { session } from '@levoja/web-kit/client';
import { Button, cn, errorMessage, Input } from '@levoja/web-kit/ui';
import { ConsentFields, Consents, emptyPerson, PersonFields, personBody, validatePerson } from '@/components/signup-fields';

export default function DriverSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState(emptyPerson);
  const [birthDate, setBirthDate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [location, setLocation] = useState(false);
  const [consents, setConsents] = useState<Consents>({ terms: false, marketing: false, extra: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = { ...validatePerson(form, true) };
    if (!birthDate) found.birthDate = 'Informe sua data de nascimento.';
    else if (!isAdult(new Date(`${birthDate}T12:00:00`))) found.birthDate = 'É necessário ter 18 anos ou mais.';
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!consents.terms || !consents.extra) return setError('Aceite os Termos de Uso, a Política de Privacidade e os Termos do Entregador.');
    if (!location) return setError('A localização durante as entregas é necessária para receber ofertas.');
    setBusy(true);
    setError(undefined);
    try {
      await session.register('driver', {
        ...personBody(form),
        birthDate,
        vehicleType,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptDriverTerms: true,
        acceptLocationTracking: true,
        marketingOptIn: consents.marketing,
      });
      router.replace('/entregador');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-xl">
      <h1 className="text-2xl font-extrabold text-fg">Quero ser entregador</h1>
      <p className="mt-1 text-sm text-muted">Depois do cadastro, envie seus documentos para análise.</p>
      <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-border bg-surface p-6" noValidate>
        <PersonFields form={form} setForm={setForm} errors={errors} cpfRequired program="DRIVER" />
        <Input label="Data de nascimento" type="date" required value={birthDate} error={errors.birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Com qual veículo você vai entregar?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VEHICLE_TYPES.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => setVehicleType(type)}
                aria-pressed={vehicleType === type}
                className={cn(
                  'rounded-xl border px-3 py-3 text-sm font-medium transition',
                  vehicleType === type ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-border hover:bg-surface-2',
                )}
              >
                {VEHICLE_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          {vehicleType !== 'BICYCLE' && <p className="mt-2 text-xs text-muted">Será necessário enviar CNH válida e documento do veículo (CRLV).</p>}
        </fieldset>
        <ConsentFields
          consents={consents}
          setConsents={setConsents}
          extra={{
            label: (
              <>
                Li e aceito os{' '}
                <Link href="/termos-entregador" target="_blank" className="text-brand-600 underline">
                  Termos do Entregador Parceiro
                </Link>
                .
              </>
            ),
          }}
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={location} onChange={(e) => setLocation(e.target.checked)} />
          <span>Autorizo o uso da minha localização enquanto estiver online ou realizando entregas.</span>
        </label>
        {error && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Criar cadastro
        </Button>
      </form>
    </div>
  );
}
