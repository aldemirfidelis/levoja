'use client';

import { FormEvent, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@levoja/web-kit/client';
import { Button, errorMessage, Input, Select, Textarea } from '@levoja/web-kit/ui';

const AUDIENCES = [
  { value: 'CUSTOMER', label: 'Sou cliente' },
  { value: 'COMPANY', label: 'Sou empresa / quero vender' },
  { value: 'DRIVER', label: 'Sou entregador' },
  { value: 'PRESS', label: 'Imprensa' },
  { value: 'OTHER', label: 'Outro assunto' },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', audience: 'CUSTOMER', subject: '', message: '' });
  const [protocol, setProtocol] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<{ protocol: string }>('contact', { ...form, phone: form.phone || undefined });
      setProtocol(result.protocol);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-extrabold text-fg sm:text-4xl">Fale conosco</h1>
      <p className="mt-3 text-muted">Respondemos em até 2 dias úteis. Para um pedido em andamento, use o suporte no app.</p>

      {protocol ? (
        <div className="mt-8 rounded-2xl border border-success/30 bg-success/10 p-6 text-center" role="status">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
          <p className="mt-3 font-semibold text-fg">Mensagem enviada!</p>
          <p className="mt-1 text-sm text-muted">Enviamos uma confirmação para o seu e-mail. Protocolo: {protocol}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 grid gap-4 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-2">
          <Input label="Nome" required value={form.name} onChange={set('name')} autoComplete="name" />
          <Input label="E-mail" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
          <Input label="Telefone (opcional)" value={form.phone} onChange={set('phone')} autoComplete="tel" />
          <Select label="Você é" value={form.audience} onChange={set('audience')} options={AUDIENCES} />
          <Input className="sm:col-span-2" label="Assunto" required value={form.subject} onChange={set('subject')} />
          <Textarea className="sm:col-span-2" label="Mensagem" rows={6} required minLength={10} value={form.message} onChange={set('message')} />
          {error && (
            <p className="text-sm text-danger sm:col-span-2" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs text-muted sm:col-span-2">Usamos seus dados apenas para responder a esta mensagem, conforme a Política de Privacidade.</p>
          <Button type="submit" size="lg" loading={busy} className="sm:col-span-2">
            Enviar mensagem
          </Button>
        </form>
      )}
    </div>
  );
}
