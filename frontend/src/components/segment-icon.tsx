import {
  CupSoda,
  FileText,
  Gift,
  MoreHorizontal,
  Package,
  Pill,
  ShoppingBasket,
  Store,
  Utensils,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  pill: Pill,
  'shopping-basket': ShoppingBasket,
  store: Store,
  'cup-soda': CupSoda,
  gift: Gift,
  wrench: Wrench,
  'file-text': FileText,
  package: Package,
  zap: Zap,
  'more-horizontal': MoreHorizontal,
};

export function SegmentIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Store;
  return <Icon className={className} aria-hidden />;
}
