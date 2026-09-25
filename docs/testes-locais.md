# Testes locais

Como rodar a plataforma inteira no notebook e testar:

- a API;
- o portal (clientes, empresas, entregadores e site);
- o painel da equipe;
- os apps Android num celular ligado por cabo USB.

Tudo usa dados fictícios. Os pagamentos, e-mails, push e mapas ficam em modo de desenvolvimento, sem serviços externos.

> **Dados de teste nunca vão para produção.** O `db:seed:dev` se recusa a rodar com `NODE_ENV=production`.

## O que roda onde

| Serviço | Endereço | Como subir |
|---|---|---|
| PostgreSQL (embutido) | `localhost:5433` | `pnpm db:embedded` (deixe o terminal aberto) |
| API | http://localhost:3333 (documentação em `/docs`) | `pnpm dev:api` |
| Portal | http://localhost:3000 | `pnpm dev:web` |
| Painel da equipe | http://localhost:3001 (login em `/login`) | `pnpm dev:admin` |
| App do cliente (Metro) | porta 8081 | `pnpm dev:client` |
| App do entregador (Metro) | porta 8082 | `cd mobile-driver && npx expo start --port 8082` |

Para conferir se a API está pronta, abra http://localhost:3333/health/ready. O resultado esperado é `database: up`.

## 1. Banco de dados

Os bancos `levoja` (desenvolvimento) e `levoja_test` (testes automáticos) precisam estar em **UTF-8**.

Os bancos antigos, criados em WIN1252, foram renomeados para `levoja_win1252_backup` e `levoja_test_win1252_backup`. Nada foi apagado. Quando não precisar mais deles, pode removê-los: `DROP DATABASE "levoja_win1252_backup";`.

Para montar um banco do zero (mesmo processo usado aqui):

```bash
pnpm db:embedded                     # terminal 1 (fica aberto)
cd backend
npx prisma migrate deploy            # cria todas as tabelas (fases 1 a 10)
npx tsx prisma/seed.ts               # tenant, papéis, segmentos, preços, planos, documentos e Super Admin
npx tsx prisma/seed-dev.ts           # 10 empresas, 30 clientes, 20 entregadores, 100 produtos, 200 pedidos
```

O `seed-dev` também:

- liga a **Fidelidade** e o **Indique e ganhe** (só em desenvolvimento);
- cria cupons de exemplo:
  - listados no app: `BEMVINDO10`, `FRETEGRATIS` e `LOJA5`;
  - exclusivo do nível Prata: `PRATA15`;
  - só com o código: `SEGREDO20`.

## 2. Contas de acesso

| Perfil | Login | Senha |
|---|---|---|
| Super Admin (painel) | `admin@levoja.local` | Exibida uma vez pelo `seed.ts`. Troque no primeiro acesso. |
| Clientes | `<nome>.<0 a 29>@dev.levoja.local` (ex.: `ana.silva.0@dev.levoja.local`) | Exibida no fim do `seed-dev.ts`, ou o valor de `DEV_SEED_PASSWORD` |
| Empresas (donos) | `<nome>.<100 a 109>@dev.levoja.local` (ex.: `ana.costa.100@dev.levoja.local`) | Mesma senha dos clientes |
| Entregadores | `<nome>.<200 a 219>@dev.levoja.local` (ex.: `ana.ferreira.200@dev.levoja.local`) | Mesma senha dos clientes |

A lista completa de contas fica no painel, em **Usuários**.

As senhas nunca ficam no código nem neste documento. Se perder a senha do Super Admin:

1. Use "Esqueci minha senha" no painel.
2. Com `MAIL_DRIVER=log`, o e-mail com o link aparece no console da API.

## 3. Portais web

1. Suba `pnpm dev:api`, `pnpm dev:web` e `pnpm dev:admin`, cada um num terminal.
2. **Portal** (http://localhost:3000):
   - site institucional;
   - cadastro de cliente, empresa e entregador, com o campo "Código de indicação";
   - área da empresa: pedidos, catálogo, cupons, **Frota própria**, **Indique e ganhe**, plano, integrações;
   - área do cliente: entregas avulsas, créditos e **Indique e ganhe**.
3. **Painel** (http://localhost:3001):
   - operação, pedidos e entregas;
   - financeiro, cupons (agora com "Divulgação" e "Nível mínimo");
   - **Fidelidade e indicação**: números, contas, ajustes, liberação ou recusa de indicações, regras;
   - antifraude, inteligência, cidades, planos, tenants.

**PWA (instalar o portal).** O service worker só funciona no build de produção:

```bash
pnpm --filter @levoja/frontend build
pnpm --filter @levoja/frontend start       # http://localhost:3000
```

No Chrome aparece o convite "Instalar". Para testar a página offline, desligue a rede no DevTools e recarregue.

As notificações do navegador:

1. Ative em **Minha conta → Notificações → Ativar no navegador**.
2. Elas aparecem quando a aba está em segundo plano.

## 4. Apps Android no celular (cabo USB)

### Preparar o celular (uma vez)

1. Em Configurações → Sobre o telefone, toque 7 vezes em **Número da versão** para ativar o modo desenvolvedor.
2. Em Opções do desenvolvedor, ative **Depuração USB**.
3. Instale o **Expo Go** pela Play Store (versão para o SDK 57).

### Conectar (sempre que plugar o cabo)

```bash
pnpm android:usb
```

O script:

- encontra o `adb` (`ANDROID_HOME`, hoje `D:\dev-cache\Android\Sdk`);
- confere se o celular autorizou a depuração;
- redireciona as portas 3333, 3000, 8081 e 8082 do celular para o notebook.

Com isso, os apps usam `http://localhost:3333` no próprio celular. Isso já está configurado em `mobile-client/.env` e `mobile-driver/.env`.

### Rodar os apps pelo Expo Go (mais rápido, sem compilar)

```bash
pnpm dev:client                              # tecle "a": abre o app do cliente no celular
cd mobile-driver && npx expo start --port 8082   # tecle "a": abre o app do entregador
```

O Expo Go tem duas limitações:

- **push não funciona no Android** (as notificações aparecem dentro do app);
- o **GPS do entregador funciona só com o app aberto**.

Todo o resto funciona igual.

**Se o Expo Go ficar parado em "New update available, downloading...":**

1. Olhe o terminal do Metro. A primeira compilação mostra `Android Bundling …%` e pode levar 1 a 2 minutos.
2. Se não aparecer progresso nem erro, pare com Ctrl+C e suba de novo limpando o cache:
   ```bash
   cd mobile-client
   npx expo start --clear
   ```
   Depois tecle `a`.
3. Confira se o celular continua autorizado com `pnpm android:usb`.

### Build nativo (GPS em segundo plano e push)

Precisa do JDK 17:

1. Instale com `winget install EclipseAdoptium.Temurin.17.JDK`.
2. Defina `JAVA_HOME`.
3. Rode:

```bash
cd mobile-driver && npx expo run:android --device   # instala o app de desenvolvimento no celular
```

## 5. Roteiro de testes

### Onde ficam os dados de exemplo

As lojas de exemplo ficam em **São Paulo** (Paulista, Pinheiros, Moema…).

- **Só navegar no app do cliente:** cadastre um endereço em São Paulo, por exemplo CEP `01310-100`, nº 1000.
- **Fazer uma entrega completa com o celular na sua cidade:**
  1. Cadastre uma empresa no portal com o seu endereço.
  2. Aprove a empresa no painel (**Empresas**).
  3. Cadastre produtos, horários e área de entrega.
  4. Use um endereço de cliente perto de você.
  5. Deixe o entregador online no mesmo local.

A oferta de entrega vai para quem está perto da loja.

### Checklist

**App do cliente:**

- [ ] Início com favoritas, "Pedir de novo", promoções, cupons e atalhos de Fidelidade e Indique e ganhe.
- [ ] Favoritar uma loja pelo coração e ver a loja em **Conta → Lojas favoritas**.
- [ ] Cupons:
  - [ ] tocar num cupom copia o código;
  - [ ] na sacola, os cupons disponíveis aparecem como botões;
  - [ ] `PRATA15` fica bloqueado para quem está no Bronze.
- [ ] Pedido completo:
  - [ ] pagamento PIX ou cartão em sandbox;
  - [ ] a loja confirma e prepara no portal;
  - [ ] o entregador aceita, coleta e entrega com o código;
  - [ ] o cliente acompanha no mapa.
- [ ] Depois da entrega:
  - [ ] pontos em **Conta → Fidelidade**;
  - [ ] troca por créditos a partir de 500 pontos;
  - [ ] avaliação.
- [ ] **Indique e ganhe:**
  - [ ] copiar ou compartilhar o código;
  - [ ] cadastrar outra conta com o código;
  - [ ] ao 1º pedido entregue (≥ R$ 30), as duas carteiras recebem o bônus.

**App do entregador:**

- [ ] Ficar online.
- [ ] Receber a oferta, aceitar, navegar, coletar e concluir com código, foto ou assinatura.
- [ ] Ver ganhos e saque.
- [ ] **Frota própria:**
  1. A empresa convida pelo e-mail ou celular no portal.
  2. O convite aparece em **Conta → Frota própria**.
  3. Aceitar, sair e recusar.
- [ ] **Indique e ganhe** para entregadores (meta: 10 entregas).

**Portal da empresa:**

- [ ] Pedidos em tempo real.
- [ ] Catálogo e estoque.
- [ ] Cupons "listados no app".
- [ ] Frota própria: o modo de entrega fica em **Dados**.
- [ ] Indique e ganhe.
- [ ] Financeiro e saque.
- [ ] Assistente.

**Painel:**

- [ ] Torre de controle.
- [ ] Fidelidade:
  - [ ] ajustar pontos com motivo;
  - [ ] rodar expiração e revisão.
- [ ] Indicações:
  - [ ] quem usa o mesmo aparelho de quem indicou fica **retido**;
  - [ ] liberar ou recusar com justificativa.
- [ ] Antifraude: sinal "Indicação suspeita".
- [ ] Auditoria de cada decisão.

### Modos de desenvolvimento

- **Pagamentos:** `PAYMENT_GATEWAY=sandbox`. O PIX é aprovado pelo botão de simulação e os cartões de teste aparecem na tela.
- **E-mails:** `MAIL_DRIVER=log`, os e-mails aparecem no console da API.
- **Push:** `PUSH_DRIVER=log`.
- **Mapas:** `MAPS_PROVIDER=haversine`, distâncias em linha reta com fator de rota.

## 6. Testes automáticos

```bash
pnpm --filter @levoja/backend test:all      # unitários + E2E (banco levoja_test)
pnpm --filter @levoja/shared test
pnpm --filter @levoja/mobile-kit test
pnpm --filter @levoja/mobile-client test
pnpm --filter @levoja/mobile-driver test
```
