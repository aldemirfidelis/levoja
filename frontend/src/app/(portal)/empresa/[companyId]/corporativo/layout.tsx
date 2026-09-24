import { B2bNav } from '@/components/b2b';

export default function CorporateLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <B2bNav />
      {children}
    </>
  );
}
