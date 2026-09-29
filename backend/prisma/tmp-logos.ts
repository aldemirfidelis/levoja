/**
 * Script avulso (dev): gera um logo (PNG 512×512) para cada loja sem logo — cores próprias,
 * símbolo do ramo (ícones Lucide, licença ISC) e o nome — renderizado no Chrome sem interface.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChefHat, Cross, Fish, Flower2, Hamburger, HeartPulse, Leaf, ShoppingBasket, Smartphone, Store } from 'lucide-react';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const STORAGE_ROOT = resolve(process.env.STORAGE_LOCAL_PATH ?? './storage');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

interface Design {
  from: string;
  to: string;
  icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  lines: [string, string];
  ink?: string;
  font?: string;
  italic?: boolean;
  /** Detalhe extra atrás do ícone (ex.: sol vermelho do sushi) ou abaixo do nome (faixa tricolor). */
  extra?: 'sun' | 'tricolor' | '24h';
}

const DESIGNS: Record<string, Design> = {
  'Burger Paulista': { from: '#FFB020', to: '#E8321A', icon: Hamburger, lines: ['Burger', 'Paulista'], font: "'Arial Black', 'Segoe UI Black', sans-serif" },
  'Cantina da Nonna': { from: '#1E7B3A', to: '#0B4D2A', icon: ChefHat, lines: ['Cantina', 'da Nonna'], font: "Georgia, 'Times New Roman', serif", italic: true, extra: 'tricolor' },
  'Conveniência 24h': { from: '#2F6BFF', to: '#1E3A8A', icon: Store, lines: ['Conveniência', '24 horas'], font: "'Segoe UI Black', 'Arial Black', sans-serif", extra: '24h' },
  'Drogaria Bem Estar': { from: '#1FC8B0', to: '#0F766E', icon: HeartPulse, lines: ['Drogaria', 'Bem Estar'], font: "'Segoe UI Black', 'Arial Black', sans-serif" },
  'Empório Natural': { from: '#8BC34A', to: '#3F6212', icon: Leaf, lines: ['Empório', 'Natural'], font: "Georgia, 'Times New Roman', serif", italic: true },
  'Farmácia Saúde Já': { from: '#F04438', to: '#B42318', icon: Cross, lines: ['Farmácia', 'Saúde Já'], font: "'Segoe UI Black', 'Arial Black', sans-serif" },
  'Floricultura Primavera': { from: '#F778BA', to: '#B8196B', icon: Flower2, lines: ['Floricultura', 'Primavera'], font: "Georgia, 'Times New Roman', serif", italic: true },
  'Mercadinho do Bairro': { from: '#FFD84D', to: '#F59E0B', icon: ShoppingBasket, lines: ['Mercadinho', 'do Bairro'], ink: '#3A2A05', font: "'Arial Black', 'Segoe UI Black', sans-serif" },
  'Sushi Liberdade': { from: '#253041', to: '#0B0F19', icon: Fish, lines: ['Sushi', 'Liberdade'], font: "'Segoe UI Black', 'Arial Black', sans-serif", extra: 'sun' },
  'Tech Store Augusta': { from: '#8B5CF6', to: '#4338CA', icon: Smartphone, lines: ['Tech Store', 'Augusta'], font: "Consolas, 'Segoe UI', monospace" },
};

function html(design: Design): string {
  const ink = design.ink ?? '#FFFFFF';
  const icon = renderToStaticMarkup(createElement(design.icon, { size: 150, color: ink, strokeWidth: 1.9 }));
  const longest = Math.max(...design.lines.map((line) => line.length));
  const size = longest > 11 ? 40 : longest > 9 ? 46 : 52;
  const extraTop =
    design.extra === 'sun'
      ? '<div style="position:absolute;width:200px;height:200px;border-radius:50%;background:#E23B2E;top:92px;left:156px"></div>'
      : '';
  const extraBottom =
    design.extra === 'tricolor'
      ? '<div style="display:flex;height:9px;width:150px;border-radius:5px;overflow:hidden;margin-top:6px"><i style="flex:1;background:#1E9E4A"></i><i style="flex:1;background:#fff"></i><i style="flex:1;background:#D7263D"></i></div>'
      : design.extra === '24h'
        ? '<div style="margin-top:6px;padding:2px 16px;border-radius:999px;background:#FFC22E;color:#1E3A8A;font:900 26px \'Segoe UI Black\',sans-serif">ABERTO SEMPRE</div>'
        : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:512px;height:512px;overflow:hidden;background:${design.to}}
.logo{position:relative;width:512px;height:512px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.22),transparent 55%),linear-gradient(150deg,${design.from},${design.to})}
.ring{position:absolute;inset:30px;border-radius:50%;border:5px solid ${ink === '#FFFFFF' ? 'rgba(255,255,255,.28)' : 'rgba(58,42,5,.22)'}}
.icon{position:relative;display:flex;filter:drop-shadow(0 6px 10px rgba(0,0,0,.25))}
.name{position:relative;margin-top:14px;text-align:center;color:${ink};font-family:${design.font};font-weight:900;${design.italic ? 'font-style:italic;' : 'text-transform:uppercase;'}font-size:${size}px;line-height:1.04;letter-spacing:${design.italic ? '0' : '.01em'};text-shadow:0 3px 8px rgba(0,0,0,.2)}
</style></head><body><div class="logo"><div class="ring"></div>${extraTop}<div class="icon">${icon}</div><div class="name">${design.lines.join('<br>')}</div>${extraBottom}</div></body></html>`;
}

async function main() {
  const companies = await prisma.company.findMany({ where: { logoKey: null }, select: { id: true, tradeName: true } });
  const work = join(tmpdir(), `levoja-logos-${Date.now()}`);
  await mkdir(work, { recursive: true });
  for (const company of companies) {
    const design = DESIGNS[company.tradeName];
    if (!design) {
      console.log(`– ${company.tradeName}: sem desenho definido, pulando`);
      continue;
    }
    const page = join(work, `${company.id}.html`);
    const png = join(work, `${company.id}.png`);
    await writeFile(page, html(design));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=512,512', `--screenshot=${png}`, `file:///${page.replace(/\\/g, '/')}`], { stdio: 'ignore', timeout: 90_000 });
    if (process.env.PREVIEW) {
      console.log(`prévia: ${png}`);
      continue;
    }
    const key = `public/companies/${company.id}/logo-${randomUUID()}.png`;
    const target = resolve(STORAGE_ROOT, key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(png, target);
    await prisma.company.update({ where: { id: company.id }, data: { logoKey: key } });
    console.log(`✔ ${company.tradeName} → ${key}`);
  }
  console.log(`Arquivos de trabalho: ${work}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
