import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@levoja/web-kit/utils';

export function Section({ children, className, muted }: { children: ReactNode; className?: string; muted?: boolean }) {
  return (
    <section className={cn('px-4 py-16 sm:px-6 sm:py-20', muted && 'bg-surface', className)}>
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

export function SectionTitle({ eyebrow, title, description, center }: { eyebrow?: string; title: string; description?: string; center?: boolean }) {
  return (
    <div className={cn('mb-10 max-w-3xl', center && 'mx-auto text-center')}>
      {eyebrow && <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>}
      <h2 className="text-3xl font-extrabold tracking-tight text-fg sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-lg text-muted">{description}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description: string; children?: ReactNode }) {
  return (
    <section className="border-b border-border bg-gradient-to-b from-brand-500/10 to-transparent px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-4xl text-center">
        {eyebrow && <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-600">{eyebrow}</p>}
        <h1 className="text-4xl font-extrabold tracking-tight text-fg sm:text-5xl">{title}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">{description}</p>
        {children && <div className="mt-8 flex flex-wrap justify-center gap-3">{children}</div>}
      </div>
    </section>
  );
}

export function CtaLink({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-12 items-center justify-center rounded-xl px-6 text-base font-semibold transition-colors',
        variant === 'primary' ? 'bg-brand-500 text-white hover:bg-brand-600' : 'border border-border bg-surface text-fg hover:bg-surface-2',
      )}
    >
      {children}
    </Link>
  );
}

export function FeatureGrid({ items }: { items: { icon: ReactNode; title: string; text: string }[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">{item.icon}</div>
          <h3 className="text-lg font-bold text-fg">{item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
        </div>
      ))}
    </div>
  );
}

export function Steps({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ol className="grid gap-6 md:grid-cols-3">
      {items.map((item, index) => (
        <li key={item.title} className="relative rounded-2xl border border-border bg-surface p-6">
          <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-lg font-bold text-white">{index + 1}</span>
          <h3 className="text-lg font-bold text-fg">{item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
        </li>
      ))}
    </ol>
  );
}
