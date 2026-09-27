# Handoff: Nova marca LevoJá (4a) + protótipos dos apps

Repositório alvo: `aldemirfidelis/levoja` (branch `main`).

## Visão geral
Nova identidade do LevoJá: “Levo” em azul-noite + “Ja” em degradê quente, com a **mão em V** (dois dedos para cima, “já levo, pode confiar”) no lugar do acento, com três traços de velocidade encostados no primeiro dedo. Vale para app cliente, app entregador, portal web e admin.

## Sobre os arquivos
Os `.dc.html` são **referências de design em HTML**, não código de produção. A tarefa é recriar no stack existente (Expo/React Native em `mobile-client`, `mobile-driver`, `mobile-kit`; Next.js + Tailwind v4 em `frontend`, `admin`, `web-kit`). SVGs e PNGs em `logo/`, `icons/` e `png/` **podem ser usados direto**.

## Fidelidade
Alta (hi-fi) para marca, cores, tipografia e ícones. Protótipos: hi-fi de layout e fluxo; fotos e mapa são espaços reservados.

## Tokens — o que trocar no repositório

### `mobile-kit/src/theme.ts` → `brand`
```ts
export const brand = {
  50: '#FFF4EC', 100: '#FFE3CF', 200: '#FFC49E', 300: '#FF9E66',
  400: '#FF7A1A', 500: '#FF5A1A', 600: '#E8321A', 700: '#C2250F',
} as const;
```
`lightColors.fg` → `#131A2B` (azul-noite). `success` → `#1FA36B`.

### `web-kit/src/theme.css` → `@theme`
- `--color-brand-50…900`: mesma escala acima + `800: #9A1F10`, `900: #7A1C11`.
- `--lj-fg: #131A2B`, `--lj-bg: #FAF8F5`, `--lj-success: #1FA36B`.
- `--font-sans: "Nunito", ui-sans-serif, system-ui, sans-serif;` (trocar Inter por Nunito).
- Novo: `--lj-brand-gradient: linear-gradient(175deg,#FFC22E 0%,#FF7A1A 48%,#F0301A 100%);`

### `web-kit/src/brand.ts`
`DEFAULT_BRANDING.primaryColor: '#FF5A1A'`.

### Cores
| Nome | Hex | Uso |
|---|---|---|
| Degradê Já | #FFC22E → #FF7A1A → #F0301A | “Ja” do logo, mão, CTA principal |
| Laranja | #FF5A1A | cor primária sólida |
| Gema | #FFC22E | destaques, mão sobre fundo laranja |
| Noite | #131A2B | texto, “Levo”, fundo do app entregador |
| Nuvem | #FAF8F5 | fundo claro |
| Confirmado | #1FA36B | sucesso, “pedido confirmado” |
| Texto secundário | #5E6679 | legendas |

### Tipografia
- **Nunito** (Google Fonts), pesos 400/700/800/900 + 900 itálico.
- Logo e títulos de destaque: Nunito 900 itálico, letter-spacing −0.045em.
- Slogan: Nunito 800, CAIXA ALTA, letter-spacing 0.22em — “TUDO O QUE VOCÊ PRECISA, MAIS PERTO”.
- Interface: Nunito 400–800 (escala atual de `typography` em theme.ts mantida).
- Mobile: carregar com `expo-font` / `@expo-google-fonts/nunito`.

### Componentes
- Botão primário: altura 50, raio 16, fundo `linear-gradient(135deg,#FF7A1A,#F0301A)`, texto branco Nunito 900 itálico 16, sombra `0 6px 14px rgba(240,74,26,.3)`.
- Botão secundário: fundo #131A2B, texto branco Nunito 800.
- Selo “Pedido confirmado”: pílula #E3F5EC, texto #137A4F 900 13px, com a mão branca num círculo #1FA36B.

## Ícones e assets (prontos)
- `png/mobile-client/` → copiar para `mobile-client/assets/` (icon, adaptive-foreground, adaptive-monochrome). Fundo do adaptativo Android: `#FF5A1A`.
- `png/mobile-driver/` → copiar para `mobile-driver/assets/`. Fundo do adaptativo: `#131A2B`.
- `png/notification-icon.png` e `png/splash-icon.png` → as duas pastas de assets.
- `png/web/` → favicon-16/32, apple-touch-icon (180), icon-192/512 para `frontend/public` e `admin/public`. `icons/favicon.svg` substitui `public/icon.svg`.
- `logo/levoja-simbolo.svg` (degradê) e `levoja-simbolo-branco.svg`.
- `scripts/app-icons.py` desenha o pino antigo: substituir pelos PNGs deste pacote ou reescrever a partir de `icons/*.svg`.
- Cliente = fundo laranja em degradê + mão branca. Entregador = fundo azul-noite + mão em degradê (mantém a lógica de diferenciação que já existe em `app-icons.py`).

### Construção da mão (SVG, viewBox `-24 0 88 64`)
Dedos: `<line>` com `stroke-width 10.5` e pontas arredondadas, (26.5,32)→(21.5,8) e (37.5,32)→(43.5,6.5). Palma: `M17 37C17 31.5 21 28.5 26 28.5H41C46 28.5 49 32 49 37V45C49 54.5 42 61 33 61C24 61 17 54.5 17 45Z`. Polegar: traço `M17.5 37Q28 35.5 34 46` (2.6) na cor do fundo. Tudo girado 12° em (32,36). Traços de velocidade (fora da rotação): y = 13 / 19.5 / 26, comprimentos 21 / 15 / 9, terminando em x = 20.5, `stroke-width 3.6`.

## Protótipos
`LevoJa Prototipos.dc.html` (turno 1): app cliente (início → loja → sacola → acompanhar pedido com código) e app entregador (online → aceitar corrida → código **4821** → ganhos). Ao implementar, aplicar a marca 4a acima. As telas correspondem a `mobile-client/src/app/(tabs)/index.tsx`, `loja/[id].tsx`, `sacola/[companyId].tsx`, `pedido/[id].tsx` e `mobile-driver/src/app/(tabs)/index.tsx`, `entrega/[id].tsx`, `comprovante/[id].tsx`.

## Arquivos
- `LevoJa Marca.dc.html`: todas as rodadas de marca; a escolhida é a **4a**.
- `LevoJa Prototipos.dc.html`: protótipos escolhidos.
- `logo/`, `icons/`, `png/`: assets finais.
