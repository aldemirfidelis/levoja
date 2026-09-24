import { effectivePrice, isAvailable, ProductWithRelations } from '../catalog/catalog.service';

export interface SelectedOption {
  group: string;
  option: string;
  optionId: string;
  priceDeltaCents: number;
}

export interface PricedLine {
  unitPriceCents: number;
  options: SelectedOption[];
  /** Problemas que impedem a compra (produto indisponível, opção inválida...). */
  issues: string[];
}

/**
 * Valida as opções escolhidas e calcula o preço unitário (preço vigente + acréscimos).
 * Usado no carrinho (exibição) e no checkout (fonte da verdade) — mesmas regras nos dois.
 */
export function priceLine(product: ProductWithRelations, optionIds: string[], at = new Date()): PricedLine {
  const issues: string[] = [];
  if (!isAvailable(product)) issues.push(`${product.name} está indisponível no momento.`);

  const chosen = new Set(optionIds);
  if (chosen.size !== optionIds.length) issues.push(`${product.name}: opção repetida.`);

  const options: SelectedOption[] = [];
  const knownIds = new Set<string>();
  for (const group of product.optionGroups) {
    const selected = group.options.filter((option) => chosen.has(option.id));
    group.options.forEach((option) => knownIds.add(option.id));
    if (selected.length < group.minSelect) issues.push(`${product.name}: escolha ${group.minSelect === 1 ? 'uma opção' : `ao menos ${group.minSelect} opções`} em "${group.name}".`);
    if (selected.length > group.maxSelect) issues.push(`${product.name}: no máximo ${group.maxSelect} opção(ões) em "${group.name}".`);
    for (const option of selected) {
      if (!option.isActive || (option.trackStock && option.stockQuantity <= 0)) issues.push(`${product.name}: "${option.name}" está indisponível.`);
      options.push({ group: group.name, option: option.name, optionId: option.id, priceDeltaCents: option.priceDeltaCents });
    }
  }
  if (optionIds.some((id) => !knownIds.has(id))) issues.push(`${product.name}: uma das opções escolhidas não existe mais.`);

  const unitPriceCents = Math.max(0, effectivePrice(product, at) + options.reduce((sum, option) => sum + option.priceDeltaCents, 0));
  return { unitPriceCents, options, issues };
}

/** Peso total estimado (kg) dos itens — usado na escolha do veículo e no frete. */
export function totalWeightKg(lines: { product: { weightGrams: number | null }; quantity: number }[]): number {
  return lines.reduce((sum, line) => sum + ((line.product.weightGrams ?? 0) * line.quantity) / 1000, 0);
}
