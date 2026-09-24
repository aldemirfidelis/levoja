# Roadmap por fases

Cada módulo segue o ciclo: requisitos → entidades → relações → APIs → regras de negócio → permissões →
backend → frontend → app (quando aplicável) → testes → correções. Só então o próximo módulo começa.

Legenda: ✅ concluído e testado · 🚧 em andamento · ⏳ planejado

## Fase 1 — Fundação ✅

| Item | Status |
|---|---|
| Monorepo (pnpm), pacote `@levoja/shared` com contratos compartilhados | ✅ |
| API NestJS: configuração validada, logs estruturados, erros padronizados, OpenAPI | ✅ |
| PostgreSQL + Prisma: schema, migrations, seed essencial e seed de desenvolvimento | ✅ |
| Autenticação: cadastro (cliente, empresa, entregador), login e-mail/telefone, refresh com rotação, MFA TOTP, redefinição de senha, verificação de e-mail/telefone, sessões | ✅ |
| RBAC granular (plataforma e empresa), papéis configuráveis | ✅ |
| Usuários, empresas, entregadores, aprovação de parceiros com histórico | ✅ |
| Auditoria, LGPD (termos versionados, consentimentos, exportação, anonimização) | ✅ |
| Notificações: in-app, e-mail, push (Expo), SMS/WhatsApp (interface) | ✅ |
| Multi-tenant, observabilidade (`/health`, `/metrics`), Docker, CI | ✅ |
| Painel administrativo e portal web (BFF com cookies httpOnly) | ✅ |

## Fase 2 — Marketplace ✅

| Item | Status |
|---|---|
| Catálogo: categorias, produtos, imagens, variações/adicionais, combos, estoque, promoções, produtos regulados (receita, idade mínima) | ✅ |
| Áreas de atendimento (raio, polígono, bairros, cidades) e vitrine por localização | ✅ |
| Carrinho com revalidação de preço/estoque; cotação (frete dinâmico, taxa de serviço, gorjeta) | ✅ |
| Checkout, número sequencial por tenant, máquina de estados do pedido com concorrência otimista | ✅ |
| SLA de aceite (cancelamento automático), pedidos agendados, notificações em tempo real (Socket.IO) | ✅ |
| Portal da empresa: pedidos, catálogo, área de entrega; painel: pedidos, precificação | ✅ |

## Fase 3 — Logística ✅

| Item | Status |
|---|---|
| Entregas de pedidos e avulsas (clientes e empresas), cotação e motor de precificação configurável | ✅ |
| Despacho sequencial com contador, aceite/recusa/expiração, expansão de raio, frota própria/híbrida, multipedidos | ✅ |
| Camada de mapas (estimativa offline, OSRM, Nominatim) | ✅ |
| Rastreamento GPS (tempo real e sincronização offline), geofence, ETA, rastreio público | ✅ |
| Prova de entrega (código, QR, foto, assinatura) com verificação de distância (antifraude) | ✅ |
| Entregas agendadas com capacidade por janela, falhas com motivo, avaliações | ✅ |

## Fase 4 — Financeiro ✅

| Item | Status |
|---|---|
| Gateway de pagamentos com abstração: `none` (só dinheiro), `sandbox` (proibido em produção) e Mercado Pago (PIX, cartão tokenizado, webhooks assinados) | ✅ |
| PIX com BR Code/QR e expiração; cartão com tokens do SDK (PCI); carteira de créditos; dinheiro registrado na liquidação | ✅ |
| Pedido online nasce "aguardando pagamento"; carrinho preservado até a aprovação | ✅ |
| Estornos totais/parciais (meio original ou crédito), automáticos no cancelamento; cupom devolvido | ✅ |
| Razão financeiro (ledger) idempotente com saldos "a liberar"/"disponível" e prazos de liberação | ✅ |
| Liquidação: comissão (regras por empresa/segmento, vigência), taxa de serviço, frete, repasse, gorjeta, cupons (loja/plataforma), dinheiro em mãos | ✅ |
| Limite de dívida do entregador (fora das entregas em dinheiro) e quitação por PIX | ✅ |
| Saques via PIX (manual ou automático), tarifa, retenção após troca de chave PIX, recusa/cancelamento com devolução | ✅ |
| Cupons: percentual, fixo, entrega grátis, primeira compra, horários/dias, limites por cliente e total | ✅ |
| Conciliação: relatório por período, pendências, verificação de integridade das carteiras, ajustes auditados | ✅ |
| Interfaces: painel (financeiro, pagamentos, saques, carteiras, comissões, cupons); portal (financeiro e cupons da empresa, ganhos do entregador, créditos do cliente, entrega avulsa paga com carteira) | ✅ |
| Checkout com PIX/cartão nos aplicativos | ✅ Fase 5 |
| Faturamento mensal de entregas `INVOICE` (boleto/nota) | ⏳ Fase 7 |

## Fase 5 — Aplicativos ✅

| Item | Status |
|---|---|
| Monorepo com Expo SDK 57 (React Native 0.86, Hermes), React fixado em uma única versão para web e apps | ✅ |
| `mobile-kit`: cliente HTTP (refresh token no Keychain/Keystore, renovação única e compartilhada), autenticação com MFA, React Query com foco/conectividade, Socket.IO, push por app, tema claro/escuro, componentes, mapa (Leaflet), PIX (QR + copia e cola) | ✅ |
| Telas de conta compartilhadas: perfil (foto, verificação de e-mail/celular), segurança (senha, 2FA, sessões), notificações, privacidade/LGPD (consentimentos, exportação, exclusão) | ✅ |
| App do cliente: cadastro/login, endereços (CEP + GPS), lojas por endereço/categoria/busca, cardápio com adicionais, sacola, agendamento, cupom, gorjeta, receita, PIX/cartão tokenizado/créditos/dinheiro, acompanhamento ao vivo, cancelamento, avaliação, envios avulsos com QR de recebimento, créditos | ✅ |
| App do entregador: cadastro e onboarding (dados, CNH, veículo, documentos por câmera/galeria/PDF, chave PIX, envio para análise), online/offline com aviso de uso da localização, ofertas com contador (tempo real + push em canal próprio), rota com navegação externa, coleta/entrega, prova por código, QR, foto ou assinatura, falha/desistência, avaliações, ganhos, saques e quitação por PIX | ✅ |
| Tolerância offline do entregador: fila persistente (GPS em lotes e ações em ordem), status otimista, cache da rota/entrega/painel, envio automático ao reconectar, provas guardadas no aparelho | ✅ |
| GPS em segundo plano com serviço em primeiro plano (Android) e retomada após reabrir o app | ✅ |
| API: push segmentado por app e canal Android, MFA com perfil de app, detalhe da entrega do entregador, avaliação já feita, dados de tokenização do cartão | ✅ |
| Qualidade: testes unitários (kit, cliente, entregador), E2E da API dos apps, `expo-doctor` e bundle Android no CI | ✅ |
| Publicação nas lojas (contas Google Play/App Store, EAS projectId) e validação em aparelhos iOS | ⏳ depende das contas da empresa |
| Chat e ligação mascarada entre cliente e entregador | ⏳ Fase 6 |

## Fase 6 — Operação ⏳
Torre de controle em tempo real, mapa de calor, SLA, indicadores, relatórios (BI), suporte e chat.

## Fase 7 — B2B ⏳
Entregas em lote (CSV/Excel/API), contratos, tabelas especiais, faturamento mensal, centros de custo.

## Fase 8 — Inteligência ⏳
Previsão de demanda e ETA, otimização de rotas, antifraude com score de risco, assistentes — sempre com
regras e supervisão humana para decisões críticas.

## Fase 9 — Escala ⏳
Multi-cidade, white label (domínio, marca, app), planos SaaS, API pública.
