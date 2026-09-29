/**
 * Script avulso (dev): fotos reais para os produtos sem imagem, do Wikimedia Commons (licenças
 * livres: CC0, domínio público, CC BY, CC BY-SA). Grava no armazenamento local e registra os
 * créditos (autor/licença/link) em storage/CREDITOS-FOTOS.md.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const UA = 'LevoJaDevSeed/1.0 (script local de dados de teste; baixa taxa de requisições)';
const STORAGE_ROOT = resolve(process.env.STORAGE_LOCAL_PATH ?? './storage');
const CREDITS = resolve(STORAGE_ROOT, 'CREDITOS-FOTOS.md');

/** Nome do produto → busca em inglês (a primeira regra que casar vale). */
const RULES: [RegExp, string][] = [
  [/combo fam/i, 'hamburgers and french fries'],
  [/combo/i, 'burger fries and soda'],
  [/x-tudo/i, 'double cheeseburger'],
  [/x-bacon|cheddar bacon/i, 'bacon cheeseburger'],
  [/x-egg/i, 'burger with fried egg'],
  [/x-salada/i, 'hamburger lettuce tomato'],
  [/smash/i, 'smash burger'],
  [/frango crispy/i, 'crispy chicken sandwich'],
  [/veggie|grão-de-bico/i, 'veggie burger'],
  [/costela bbq/i, 'pulled pork sandwich'],
  [/paulista clássico|x-burger/i, 'cheeseburger'],
  [/batata frita/i, 'french fries'],
  [/onion rings/i, 'onion rings'],
  [/nuggets/i, 'chicken nuggets'],
  [/milkshake/i, 'chocolate milkshake'],
  [/brownie/i, 'brownie with ice cream'],
  [/cachorro-quente/i, 'hot dog'],
  [/misto quente/i, 'grilled ham and cheese sandwich'],
  [/bruschetta/i, 'bruschetta'],
  [/parmegiana/i, 'chicken parmigiana'],
  [/lasanha/i, 'lasagna'],
  [/nhoque/i, 'gnocchi tomato sauce'],
  [/carbonara/i, 'spaghetti carbonara'],
  [/fettuccine/i, 'fettuccine alfredo'],
  [/penne/i, 'pasta pesto'],
  [/ravioli/i, 'ravioli tomato sauce'],
  [/talharim|bolonhesa/i, 'tagliatelle bolognese'],
  [/risoto/i, 'mushroom risotto'],
  [/pizza margherita/i, 'pizza margherita'],
  [/pizza calabresa/i, 'pepperoni pizza'],
  [/quatro queijos/i, 'four cheese pizza'],
  [/pão de alho/i, 'garlic bread'],
  [/cannoli/i, 'cannoli'],
  [/panna cotta/i, 'panna cotta'],
  [/tiramis/i, 'tiramisu'],
  [/pudim/i, 'flan caramel'],
  [/salada caesar/i, 'caesar salad'],
  [/feijoada/i, 'feijoada'],
  [/picanha/i, 'picanha'],
  [/bife acebolado/i, 'steak with onions and rice'],
  [/linguiça/i, 'sausage with rice and beans'],
  [/tilápia/i, 'grilled fish fillet with rice'],
  [/frango grelhado/i, 'grilled chicken breast with rice'],
  [/marmita fit/i, 'grilled chicken with vegetables'],
  [/strogonoff/i, 'chicken stroganoff'],
  [/carne moída/i, 'ground beef with rice'],
  [/marmita econ/i, 'rice beans fried egg'],
  [/marmita/i, 'rice and beans meal'],
  [/combinado 40/i, 'sushi platter'],
  [/combinado salmão/i, 'salmon sushi'],
  [/combinado/i, 'sushi set'],
  [/sashimi/i, 'salmon sashimi'],
  [/niguiri/i, 'salmon nigiri'],
  [/^hot /i, 'fried sushi roll'],
  [/uramaki/i, 'uramaki sushi'],
  [/hossomaki/i, 'cucumber maki'],
  [/temaki/i, 'temaki'],
  [/guioza/i, 'gyoza'],
  [/sunomono/i, 'sunomono'],
  [/missoshiru/i, 'miso soup'],
  [/harumaki/i, 'spring rolls'],
  [/long neck/i, 'beer bottle'],
  [/cerveja/i, 'beer can'],
  [/chianti/i, 'chianti wine bottle'],
  [/vinho/i, 'red wine bottle'],
  [/energético/i, 'energy drink can'],
  [/isotônico/i, 'sports drink bottle'],
  [/suco de caixinha/i, 'juice carton'],
  [/suco de laranja/i, 'orange juice glass'],
  [/suco/i, 'fresh fruit juice glass'],
  [/água com gás/i, 'sparkling water bottle'],
  [/água sanitária/i, 'bleach bottle'],
  [/água/i, 'mineral water bottle'],
  [/guaraná/i, 'guarana soda'],
  [/refrigerante/i, 'soda can'],
  [/amendoim/i, 'roasted peanuts'],
  [/bala de goma/i, 'gummy bears'],
  [/barra de cereal/i, 'granola bar'],
  [/batata chips|salgadinho/i, 'potato chips'],
  [/biscoito/i, 'sandwich cookies'],
  [/carvão/i, 'charcoal barbecue'],
  [/^chocolate/i, 'chocolate bar'],
  [/gelo/i, 'ice cubes'],
  [/guardanapo/i, 'paper napkins'],
  [/papel higiênico/i, 'toilet paper rolls'],
  [/pilhas/i, 'AA batteries'],
  [/pipoca/i, 'popcorn'],
  [/amoxicilina/i, 'amoxicillin capsules'],
  [/ibuprofeno/i, 'ibuprofen tablets'],
  [/omeprazol/i, 'omeprazole capsules'],
  [/cimegripe/i, 'capsules medicine'],
  [/azitromicina|dipirona|paracetamol|nimesulida|neosaldina|engov|loratadina|losartana|buscopan|dorflex/i, 'pills blister pack'],
  [/multivitam|vitamina c/i, 'vitamin tablets'],
  [/colágeno|whey/i, 'protein powder'],
  [/xarope/i, 'cough syrup'],
  [/sal de frutas/i, 'effervescent tablet'],
  [/creme dental/i, 'toothpaste'],
  [/escova dental/i, 'toothbrush'],
  [/fio dental/i, 'dental floss'],
  [/enxaguante/i, 'mouthwash'],
  [/curativo/i, 'adhesive bandages'],
  [/fralda/i, 'diapers'],
  [/lenço umedecido/i, 'wet wipes'],
  [/hidratante/i, 'body lotion bottle'],
  [/pomada/i, 'ointment tube'],
  [/protetor solar/i, 'sunscreen'],
  [/repelente/i, 'insect repellent spray'],
  [/shampoo/i, 'shampoo bottle'],
  [/soro fisiológico/i, 'saline solution'],
  [/termômetro/i, 'digital thermometer'],
  [/medidor de pressão/i, 'blood pressure monitor'],
  [/nebulizador/i, 'nebulizer'],
  [/teste de gravidez/i, 'pregnancy test'],
  [/álcool em gel/i, 'hand sanitizer'],
  [/abacate/i, 'avocado'],
  [/alface/i, 'lettuce'],
  [/arroz integral/i, 'brown rice'],
  [/arroz/i, 'white rice'],
  [/aveia/i, 'rolled oats'],
  [/azeite/i, 'olive oil bottle'],
  [/banana/i, 'bananas'],
  [/café/i, 'coffee beans'],
  [/castanha/i, 'brazil nuts'],
  [/chia/i, 'chia seeds'],
  [/detergente/i, 'dish soap'],
  [/feijão/i, 'pinto beans'],
  [/granola/i, 'granola'],
  [/iogurte/i, 'yogurt'],
  [/leite/i, 'milk carton'],
  [/maçã/i, 'fuji apples'],
  [/^mel /i, 'honey jar'],
  [/ovos/i, 'eggs carton'],
  [/fermentação|pão integral/i, 'sourdough bread'],
  [/pão de forma/i, 'sliced bread'],
  [/pão francês/i, 'bread rolls'],
  [/queijo minas/i, 'fresh white cheese'],
  [/muçarela/i, 'mozzarella cheese'],
  [/requeijão/i, 'cream cheese'],
  [/manteiga/i, 'butter'],
  [/sabão em pó/i, 'laundry detergent'],
  [/molho de tomate/i, 'tomato sauce'],
  [/tomate/i, 'tomatoes'],
  [/açúcar/i, 'sugar'],
  [/^batata/i, 'potatoes'],
  [/cebola/i, 'onions'],
  [/farinha/i, 'wheat flour'],
  [/laranja/i, 'oranges'],
  [/macarrão/i, 'dry spaghetti'],
  [/sal refinado/i, 'table salt'],
  [/óleo de soja/i, 'vegetable oil bottle'],
  [/girass/i, 'sunflowers bouquet'],
  [/lírio-da-paz/i, 'peace lily'],
  [/lírios/i, 'lilies bouquet'],
  [/balão/i, 'foil balloon'],
  [/bolo no pote/i, 'chocolate cake jar'],
  [/flores do campo/i, 'wildflower bouquet'],
  [/rosas brancas/i, 'white roses bouquet'],
  [/rosas vermelhas/i, 'bouquet of red roses'],
  [/rosa vermelha/i, 'single red rose'],
  [/tulipas/i, 'tulips bouquet'],
  [/cacto/i, 'cactus pot'],
  [/chocolates/i, 'box of chocolates'],
  [/caneca/i, 'coffee mug'],
  [/cartão/i, 'greeting card'],
  [/café da manhã/i, 'breakfast basket'],
  [/cesta/i, 'gift basket'],
  [/ervas/i, 'potted herbs'],
  [/orquídea/i, 'orchid'],
  [/pelúcia/i, 'teddy bear'],
  [/suculentas/i, 'succulents'],
  [/trufas/i, 'chocolate truffles'],
  [/vela/i, 'scented candle'],
  [/cabo/i, 'usb cable'],
  [/caixa de som/i, 'portable bluetooth speaker'],
  [/capinha/i, 'phone case'],
  [/carregador sem fio/i, 'wireless charger'],
  [/carregador/i, 'usb charger'],
  [/fone bluetooth/i, 'wireless earbuds'],
  [/fone de ouvido/i, 'earphones'],
  [/headset/i, 'gaming headset'],
  [/hub usb/i, 'usb hub'],
  [/mousepad/i, 'mouse pad'],
  [/mouse/i, 'wireless mouse'],
  [/película/i, 'screen protector'],
  [/pendrive/i, 'usb flash drive'],
  [/power bank/i, 'power bank'],
  [/ring light/i, 'ring light'],
  [/ssd/i, 'solid state drive'],
  [/smartwatch/i, 'smartwatch'],
  [/soundbar/i, 'soundbar'],
  [/suporte veicular/i, 'car phone holder'],
  [/teclado/i, 'computer keyboard'],
  [/webcam/i, 'webcam'],
];

const ALLOWED_LICENSE = /^(cc0|public domain|pd|cc by(-sa)?( \d(\.\d)?)?( [a-z]{2})?|attribution)$/i;
const BAD_TITLE = /logo|map|diagram|icon|chart|plan|flag|coat of arms|drawing|illustration|\.svg|advert|poster|screenshot/i;

interface Candidate {
  title: string;
  width: number;
  height: number;
  thumb: string;
  page: string;
  license: string;
  artist: string;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const stripHtml = (value = '') => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const searchCache = new Map<string, Candidate[]>();
async function search(query: string): Promise<Candidate[]> {
  const cached = searchCache.get(query);
  if (cached) return cached;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '800',
  });
  // O Wikimedia limita rajadas: com resposta que não é JSON (página de limite) espera e tenta de novo.
  let raw = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}&maxlag=5`, { headers: { 'User-Agent': UA } });
    raw = await response.text();
    if (response.ok && raw.startsWith('{') && !raw.includes('"error"')) break;
    const wait = 15_000 * (attempt + 1);
    console.log(`  (limite do Wikimedia, aguardando ${wait / 1000}s)`);
    await pause(wait);
  }
  const data = JSON.parse(raw) as { query?: { pages?: Record<string, { index: number; title: string; imageinfo?: { width: number; height: number; mime: string; thumburl: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  const candidates: Candidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info || info.mime !== 'image/jpeg' || BAD_TITLE.test(page.title)) continue;
    const license = stripHtml(info.extmetadata?.LicenseShortName?.value);
    if (!ALLOWED_LICENSE.test(license)) continue;
    if (info.width < 900 || info.width / info.height < 0.95 || info.width / info.height > 2.2) continue;
    candidates.push({ title: page.title, width: info.width, height: info.height, thumb: info.thumburl, page: info.descriptionurl, license, artist: stripHtml(info.extmetadata?.Artist?.value) || 'autor desconhecido' });
  }
  // Paisagem 4:3 a 16:9 primeiro (o card do app é 4:3).
  candidates.sort((a, b) => Number(b.width / b.height >= 1.25) - Number(a.width / a.height >= 1.25));
  searchCache.set(query, candidates);
  await pause(1500);
  return candidates;
}

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': UA } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status === 429 || response.status >= 500) {
      await pause(3000 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${response.status}`);
  }
  throw new Error('muitas tentativas');
}

/**
 * Correções (REDO=1): produtos cuja foto automática não ficou boa → nova busca. A foto anterior
 * (registro e arquivo) é removida antes. Títulos em `avoid` nunca são escolhidos.
 */
const OVERRIDES: [RegExp, string][] = [];
const AVOID = new Set<string>();

async function main() {
  if ((process.env.STORAGE_DRIVER ?? 'local') !== 'local') throw new Error('Este script grava no armazenamento local (STORAGE_DRIVER=local).');
  const redo = !!process.env.REDO;
  const all = await prisma.product.findMany({
    where: { deletedAt: null, ...(redo ? {} : { images: { none: {} } }) },
    select: { id: true, name: true, companyId: true, company: { select: { tradeName: true } }, images: { select: { id: true, fileKey: true } } },
    orderBy: [{ company: { tradeName: 'asc' } }, { sortOrder: 'asc' }],
  });
  const products = redo ? all.filter((product) => OVERRIDES.some(([pattern]) => pattern.test(product.name))) : all;
  if (redo) {
    for (const product of products) {
      for (const image of product.images) {
        await prisma.productImage.delete({ where: { id: image.id } });
        await rm(resolve(STORAGE_ROOT, image.fileKey), { force: true });
      }
    }
    RULES.unshift(...OVERRIDES);
  }
  console.log(`${products.length} produto(s) sem foto`);
  if (process.env.DRY) {
    const unmatched = products.filter((product) => !RULES.some(([pattern]) => pattern.test(product.name)));
    console.log(`sem regra: ${unmatched.map((product) => `${product.company.tradeName}: ${product.name}`).join(' | ') || 'nenhum'}`);
    for (const product of products) console.log(`  ${product.name} → ${RULES.find(([pattern]) => pattern.test(product.name))?.[1]}`);
    return;
  }
  await mkdir(STORAGE_ROOT, { recursive: true });
  await appendFile(CREDITS, `\n## Fotos de produtos (Wikimedia Commons) — ${new Date().toISOString().slice(0, 10)}\n\n| Loja | Produto | Arquivo | Autor | Licença |\n|---|---|---|---|---|\n`);

  // Mesma busca na mesma loja: usa fotos diferentes (1ª, 2ª, 3ª opção...).
  const usedInStore = new Map<string, Set<string>>();
  let ok = 0;
  const missing: string[] = [];
  for (const product of products) {
    const rule = RULES.find(([pattern]) => pattern.test(product.name));
    if (!rule) {
      missing.push(`${product.company.tradeName}: ${product.name} (sem regra)`);
      continue;
    }
    const used = usedInStore.get(product.companyId) ?? new Set<string>();
    usedInStore.set(product.companyId, used);
    try {
      const candidates = await search(rule[1]);
      const choice = candidates.find((candidate) => !used.has(candidate.title) && !AVOID.has(candidate.title)) ?? candidates.find((candidate) => !AVOID.has(candidate.title));
      if (!choice) {
        missing.push(`${product.company.tradeName}: ${product.name} (nada em "${rule[1]}")`);
        continue;
      }
      used.add(choice.title);
      const body = await download(choice.thumb);
      const key = `public/products/${product.companyId}/${product.id}/${randomUUID()}.jpg`;
      const path = resolve(STORAGE_ROOT, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await prisma.productImage.create({ data: { productId: product.id, fileKey: key, sortOrder: 0 } });
      await appendFile(CREDITS, `| ${product.company.tradeName} | ${product.name} | [${choice.title.replace(/\|/g, '/')}](${choice.page}) | ${choice.artist.replace(/\|/g, '/').slice(0, 80)} | ${choice.license} |\n`);
      ok += 1;
      console.log(`✔ ${product.company.tradeName} · ${product.name} ← ${choice.title} (${choice.license})`);
      await pause(1000);
    } catch (error) {
      missing.push(`${product.company.tradeName}: ${product.name} (${(error as Error).message})`);
    }
  }
  console.log(`\n${ok} foto(s) adicionada(s).`);
  if (missing.length) console.log(`Sem foto (${missing.length}):\n- ${missing.join('\n- ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
