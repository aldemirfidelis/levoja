import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, Section } from '@/components/marketing';
import { FAQ } from '@/lib/faq';

export const metadata: Metadata = { title: 'Perguntas frequentes' };

export default function FaqPage() {
  return (
    <>
      <PageHero eyebrow="FAQ" title="Perguntas frequentes" description="Não encontrou o que procurava? Fale com a gente pela página de contato." />
      <Section>
        <div className="mx-auto max-w-3xl space-y-10">
          {FAQ.map((group) => (
            <div key={group.title}>
              <h2 className="mb-4 text-xl font-bold text-fg">{group.title}</h2>
              <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
                {group.items.map((item) => (
                  <details key={item.q} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-fg">
                      {item.q}
                      <span className="text-muted transition group-open:rotate-45" aria-hidden>
                        +
                      </span>
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-muted">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
          <p className="text-center text-sm text-muted">
            Ainda com dúvidas?{' '}
            <Link href="/contato" className="font-medium text-brand-600 hover:underline">
              Entre em contato
            </Link>
          </p>
        </div>
      </Section>
    </>
  );
}
