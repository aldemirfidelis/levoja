import type { ImageSourcePropType } from 'react-native';

/**
 * Ilustrações 3D das categorias do início — Fluent Emoji 3D (Microsoft, licença MIT;
 * ver assets/categories/LICENSE-fluentui-emoji.txt).
 */
const ART = {
  restaurant: require('../../assets/categories/restaurant.png'),
  pharmacy: require('../../assets/categories/pharmacy.png'),
  market: require('../../assets/categories/market.png'),
  shops: require('../../assets/categories/shops.png'),
  drinks: require('../../assets/categories/drinks.png'),
  gifts: require('../../assets/categories/gifts.png'),
  services: require('../../assets/categories/services.png'),
  other: require('../../assets/categories/other.png'),
  pet: require('../../assets/categories/pet.png'),
  package: require('../../assets/categories/package.png'),
  document: require('../../assets/categories/document.png'),
  express: require('../../assets/categories/express.png'),
  bakery: require('../../assets/categories/bakery.png'),
  flowers: require('../../assets/categories/flowers.png'),
  pizza: require('../../assets/categories/pizza.png'),
} satisfies Record<string, ImageSourcePropType>;

export type CategoryArt = keyof typeof ART;

/** Segmentos padrão, pelo slug. */
const BY_SLUG: Record<string, CategoryArt> = {
  restaurantes: 'restaurant',
  farmacias: 'pharmacy',
  mercado: 'market',
  lojas: 'shops',
  conveniencia: 'drinks',
  presentes: 'gifts',
  servicos: 'services',
  outros: 'other',
  pet: 'pet',
  'pet-shop': 'pet',
  padarias: 'bakery',
  floriculturas: 'flowers',
  pizzarias: 'pizza',
  documentos: 'document',
  encomendas: 'package',
  'entrega-expressa': 'express',
};

/** Segmentos criados no admin: pelo ícone (nomes do Lucide). */
const BY_ICON: Record<string, CategoryArt> = {
  utensils: 'restaurant',
  'utensils-crossed': 'restaurant',
  hamburger: 'restaurant',
  pill: 'pharmacy',
  'shopping-basket': 'market',
  'shopping-cart': 'market',
  store: 'shops',
  'shopping-bag': 'shops',
  'cup-soda': 'drinks',
  wine: 'drinks',
  beer: 'drinks',
  gift: 'gifts',
  wrench: 'services',
  hammer: 'services',
  paw: 'pet',
  'paw-print': 'pet',
  dog: 'pet',
  cat: 'pet',
  croissant: 'bakery',
  flower: 'flowers',
  'flower-2': 'flowers',
  pizza: 'pizza',
  package: 'package',
  'file-text': 'document',
  zap: 'express',
};

/**
 * Fundo de cada categoria: tom pastel no tema claro e a mesma cor translúcida no escuro
 * (a cor de destaque com ~16% de opacidade sobre o fundo do app).
 */
const TINT: Record<CategoryArt, { light: string; accent: string }> = {
  restaurant: { light: '#FCEBDD', accent: '#F08A4B' },
  pharmacy: { light: '#EEE6F4', accent: '#9B7BC4' },
  market: { light: '#FBEFDF', accent: '#E8A23B' },
  shops: { light: '#E3EAF7', accent: '#5B86D6' },
  drinks: { light: '#FBE4E4', accent: '#E0575B' },
  gifts: { light: '#EFE6F5', accent: '#A06CD5' },
  services: { light: '#ECECEE', accent: '#8A8F98' },
  other: { light: '#E1EFE8', accent: '#3FA37A' },
  pet: { light: '#F6ECDF', accent: '#C58B4E' },
  package: { light: '#FCEBDD', accent: '#D9964A' },
  document: { light: '#E6EDF7', accent: '#5B86D6' },
  express: { light: '#FFF3D1', accent: '#E6B400' },
  bakery: { light: '#F8ECDE', accent: '#D59A55' },
  flowers: { light: '#FBE6EE', accent: '#E0678F' },
  pizza: { light: '#FDE8DB', accent: '#E0703A' },
};

export function categoryTint(key: CategoryArt, dark: boolean): string {
  return dark ? `${TINT[key].accent}29` : TINT[key].light;
}

export function categoryArt(key: CategoryArt): ImageSourcePropType {
  return ART[key];
}

/** Categoria visual de um segmento (slug, depois ícone; senão a genérica). */
export function segmentArtKey(segment: { slug: string; icon: string | null }): CategoryArt {
  return BY_SLUG[segment.slug] ?? (segment.icon ? BY_ICON[segment.icon] : undefined) ?? 'other';
}

/** Ilustração de um segmento (slug, depois ícone; senão a genérica). */
export function segmentArt(segment: { slug: string; icon: string | null }): ImageSourcePropType {
  return ART[segmentArtKey(segment)];
}
