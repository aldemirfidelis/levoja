import Link from 'next/link';
import { Logo } from '@/components/site-chrome';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link href="/ajuda" className="text-sm text-muted hover:text-fg">
            Precisa de ajuda?
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">{children}</main>
    </div>
  );
}
