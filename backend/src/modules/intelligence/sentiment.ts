import type { ReviewTheme } from '@levoja/shared';

/**
 * Análise de avaliações sem modelo de linguagem (modo padrão e fallback da IA): léxico em
 * português com negação ("não gostei") e intensificadores ("muito bom"), combinado com a nota.
 * Temas vêm de palavras-chave de uma lista fechada (REVIEW_THEME_LABELS).
 */

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

export interface ReviewAnalysis {
  sentiment: Sentiment;
  /** Pontuação contínua (negativa a positiva); ≥ 1 positiva, ≤ -1 negativa. */
  score: number;
  themes: ReviewTheme[];
}

const POSITIVE = [
  'bom', 'boa', 'otimo', 'otima', 'excelente', 'perfeito', 'perfeita', 'maravilhoso', 'maravilhosa', 'gostei', 'adorei', 'amei',
  'recomendo', 'rapido', 'rapida', 'educado', 'educada', 'simpatico', 'simpatica', 'atencioso', 'atenciosa', 'gentil', 'quentinho',
  'quentinha', 'saboroso', 'saborosa', 'delicioso', 'deliciosa', 'pontual', 'caprichado', 'caprichada', 'top', 'show', 'parabens',
  'nota10', 'impecavel', 'cuidadoso', 'cuidadosa', 'bem', 'certinho', 'fresco', 'fresca', 'agil', 'eficiente', 'satisfeito', 'satisfeita',
];
const NEGATIVE = [
  'ruim', 'pessimo', 'pessima', 'horrivel', 'terrivel', 'atrasou', 'atrasado', 'atrasada', 'atraso', 'demorou', 'demorado', 'demorada',
  'demora', 'frio', 'fria', 'gelado', 'gelada', 'errado', 'errada', 'faltou', 'faltando', 'falta', 'grosso', 'grossa', 'grosseiro',
  'grosseira', 'mal', 'educacao', 'sujo', 'suja', 'amassado', 'amassada', 'vazou', 'vazando', 'derramado', 'derramou', 'quebrado',
  'quebrada', 'estragado', 'estragada', 'caro', 'cara', 'decepcionante', 'decepcao', 'decepcionado', 'decepcionada', 'nunca', 'lixo',
  'reclamacao', 'problema', 'cancelou', 'sumiu', 'insatisfeito', 'insatisfeita', 'lento', 'lenta', 'descaso', 'desrespeito', 'mentiu',
];
const NEGATIONS = new Set(['nao', 'nem', 'sem', 'jamais']);
const INTENSIFIERS = new Set(['muito', 'super', 'bem', 'demais', 'extremamente', 'bastante', 'tao', 'mega']);

/** "mal educado" e "falta de educação" são negativos apesar de "educado"/"educação". */
const PHRASES: [RegExp, number][] = [
  [/\bmal[ -]educad[oa]\b/g, -2],
  [/\bfalta de educacao\b/g, -2],
  [/\bsem educacao\b/g, -2],
  [/\bnao recomendo\b/g, -2.5],
  [/\bnunca mais\b/g, -2.5],
  [/\bchegou (frio|fria|gelad[oa])\b/g, -1],
];

const THEMES: Record<ReviewTheme, RegExp> = {
  delay: /\b(atras\w*|demor\w*|lent[oa]|esper(ei|amos|ando)|hora[s]? pra|tard[e]?)\b/,
  speed: /\b(rapid[oa]s?|rapidez|agil|pontual|no prazo|antes do previsto|voou)\b/,
  food_quality: /\b(sabor\w*|gostos[oa]|delicios[oa]|comida|lanche|pizza|qualidade|fresc[oa]|estragad[oa]|cru[a]?|salgad[oa])\b/,
  temperature: /\b(fri[oa]|gelad[oa]|quent\w*|morn[oa])\b/,
  packaging: /\b(embalage\w+|vazou|vazando|derram\w+|lacr\w+|sacola|amassad[oa])\b/,
  missing_item: /\b(falt\w+|errad[oa]|trocad[oa]|nao veio|veio sem|esquec\w+|incomplet[oa])\b/,
  damaged: /\b(quebrad[oa]|danificad[oa]|amassad[oa]|avariad[oa]|rasgad[oa]|estragad[oa])\b/,
  courtesy: /\b(educad[oa]|simpatic[oa]|gentil|atencios[oa]|cordial|prestativ[oa]|cuidados[oa])\b/,
  rudeness: /\b(grosse\w*|gross[oa]|mal[ -]educad[oa]|falta de educacao|sem educacao|rude|estupid[oa]|desrespeit\w+|ignorante)\b/,
  price: /\b(car[oa]|preco\w*|valor|taxa|frete|barat[oa]|custo)\b/,
  communication: /\b(mensage\w+|respond\w+|avis\w+|ligou|ligacao|comunica\w+|chat|contato)\b/,
  location: /\b(endereco|portaria|localiza\w+|mapa|gps|perdid[oa]|nao achou|nao encontrou|local)\b/,
  app: /\b(aplicativo|app|sistema|site|travou|bug|pagamento)\b/,
};

export const normalizeText = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Pontuação vira fronteira de oração: a negação não atravessa vírgulas ("não demorou, educado").
    .replace(/[.,;:!?]+/g, ' | ')
    .replace(/[^a-z0-9\s|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function analyzeReview(rating: number, comment: string | null | undefined, tags: string[] = []): ReviewAnalysis {
  const text = normalizeText([comment ?? '', ...tags].join(' '));
  let lexical = 0;
  let rest = text;
  for (const [pattern, weight] of PHRASES) {
    const matches = rest.match(pattern);
    if (matches) {
      lexical += weight * matches.length;
      rest = rest.replace(pattern, ' ');
    }
  }
  const tokens = rest.split(' ').filter(Boolean);
  tokens.forEach((token, index) => {
    const polarity = POSITIVE.includes(token) ? 1 : NEGATIVE.includes(token) ? -1 : 0;
    if (!polarity) return;
    const before = tokens.slice(Math.max(0, index - 3), index);
    const boundary = before.lastIndexOf('|');
    const window = boundary >= 0 ? before.slice(boundary + 1) : before;
    const negated = window.some((word) => NEGATIONS.has(word));
    const intensified = window.some((word) => INTENSIFIERS.has(word));
    lexical += polarity * (negated ? -0.8 : 1) * (intensified ? 1.5 : 1);
  });

  // A nota pesa sempre; o texto confirma ou contradiz (ex.: 5 estrelas com "chegou frio").
  const score = Math.round(((rating - 3) * 0.9 + Math.max(-4, Math.min(4, lexical))) * 100) / 100;
  const sentiment: Sentiment = score >= 1 ? 'POSITIVE' : score <= -1 ? 'NEGATIVE' : 'NEUTRAL';
  const themes = text ? (Object.keys(THEMES) as ReviewTheme[]).filter((theme) => THEMES[theme].test(text)) : [];
  // Temas opostos: mantém o que concorda com o sentimento.
  const resolved = themes.filter((theme) => {
    if (theme === 'courtesy' && themes.includes('rudeness')) return false;
    if (theme === 'speed' && themes.includes('delay')) return sentiment === 'POSITIVE';
    if (theme === 'delay' && themes.includes('speed')) return sentiment !== 'POSITIVE';
    return true;
  });
  return { sentiment, score, themes: resolved };
}
