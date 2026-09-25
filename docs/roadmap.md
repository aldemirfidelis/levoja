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
| Faturamento mensal de entregas `INVOICE` | ✅ Fase 7 |

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
| Chat e ligação mascarada entre cliente e entregador | ✅ Fase 6 |

## Fase 6 — Operação ✅

| Item | Status |
|---|---|
| Chat por pedido/entrega (cliente ↔ loja, cliente ↔ entregador, loja ↔ entregador): participantes recalculados a cada acesso, janela de encerramento configurável, sem exposição de telefones, leitura da equipe auditada | ✅ |
| Ligação mascarada por ponte telefônica (Twilio) com limite por conversa; desativada sem provedor (`VOICE_PROVIDER=none`) | ✅ |
| Central de atendimento: chamados de clientes, entregadores e empresas, categorias, prioridade automática, SLA de primeira resposta e resolução (configurável), alerta de SLA estourado, notas internas, anexos privados validados pelo conteúdo, atribuição, reabertura, encerramento automático e avaliação (CSAT) | ✅ |
| Torre de controle: entregadores online/ocupados/sem sinal, entregas aguardando/atrasadas, indicadores do dia (SLA, tempos de atribuição, coleta, percurso e entrega, pedidos/hora), oferta x demanda por região e alertas priorizados; tempo real + atualização periódica | ✅ |
| Mapa de calor (demanda, pedidos, entregas, disponibilidade de entregadores) por período, faixa de horário, cidade e tamanho de célula; presença de entregadores guardada apenas de forma agregada, com retenção configurável | ✅ |
| Relatórios (BI): comercial, operacional, financeiro (razão da plataforma) e entregadores, com filtros de período, agrupamento, cidade, segmento e empresa; exportação CSV (Excel pt-BR) auditada | ✅ |
| Painel da empresa: vendas, pedidos, ticket médio, receita líquida, taxas, avaliações, tempos de preparo/entrega, conversão (visitas à loja) e mais vendidos | ✅ |
| Painel administrativo ampliado (pedidos, GMV, entregas, receita, cancelamentos, chamados, avaliações, entregadores ativos) | ✅ |
| Comunicados: promoções só pelos canais com consentimento (LGPD) e avisos operacionais para entregadores/empresas, com estimativa de alcance e envio em lotes | ✅ |
| LGPD: exportação inclui mensagens e chamados; exclusão remove o conteúdo escrito pelo titular e seus anexos | ✅ |
| Interfaces: painel (operação, mapa de calor, relatórios, atendimento, comunicados), portal (indicadores, mensagens e atendimento da empresa; atendimento do cliente e do entregador; chat nos pedidos e entregas) e apps (chat, ligação, chamados, canal de promoções) | ✅ |
| Testes: unitários (fusos, períodos, CSV) e E2E da operação (chat, chamados, SLA, torre, mapa de calor, relatórios, painéis, comunicados, LGPD) | ✅ |

## Fase 7 — B2B ✅

| Item | Status |
|---|---|
| Contratos corporativos: vigência, rascunho → ativo → suspenso → encerrado, um contrato em vigor por empresa, auditoria e aviso à empresa | ✅ |
| Tabela especial por contrato (mesmo motor de preços, sem adicional de demanda) ou desconto sobre a tabela padrão; simulador para o comercial | ✅ |
| Limites: crédito para entregas faturadas (conferido com trava por empresa), bloqueio por fatura vencida, orçamento mensal por centro de custo, centro de custo obrigatório | ✅ |
| Centros de custo, unidades/locais (coleta, destino e transferência entre unidades) e referência do cliente nas entregas | ✅ |
| Entregas em lote por CSV, Excel ou API: modelo para download, validação em segundo plano (endereços, preços, centros de custo, duplicidades), erros por linha, confirmação com reagendamento, cancelamento e resultado em CSV | ✅ |
| Rotas de lote: agrupamento por varredura angular (paradas, capacidade, trechos longos), ordem por vizinho mais próximo + 2-opt, oferta da rota inteira a um entregador livre, distribuição individual quando não há entregador para a rota | ✅ |
| Aviso ao destinatário por SMS (link de acompanhamento e código) e resumo do lote para a empresa (sem uma notificação por entrega) | ✅ |
| Entregas recorrentes (dias da semana e horário, entre unidades ou para um endereço), geradas com antecedência e uma única vez por data, com aviso de falha | ✅ |
| Faturamento mensal: fechamento no dia do contrato (com recuperação de dias perdidos), fatura por período com resumo por centro de custo, franquia mínima, vencimento, PIX com baixa automática, baixa manual, atraso, cancelamento e demonstrativo CSV | ✅ |
| Chaves de API por empresa (hash, escopos, validade, revogação), aceitas somente nas rotas de integração | ✅ |
| Relatório corporativo (portal e painel): entregas, gasto, prazo e centros de custo, com CSV | ✅ |
| Interfaces: portal (área corporativa completa e solicitação com unidades/centro de custo), painel (contratos, tabela especial, faturas, relatório corporativo) e app do entregador (ofertas de rota) | ✅ |
| Testes: unitários (rotas, planilhas, leitura de cabeçalhos) e E2E do corporativo | ✅ |
| Boleto registrado e nota fiscal de serviço (dependem de contrato com banco/prefeitura) | ⏳ integração futura |

## Fase 8 — Inteligência ✅

Regra geral: a inteligência **sugere e sinaliza**; decisões críticas (bloquear conta, aplicar preço,
responder cliente) ficam com uma pessoa, e toda ação automática é leve, configurável e reversível.

| Item | Status |
|---|---|
| Antifraude com score de risco configurável (pontos por sinal, meia-vida, limites de nível e de caso) e casos para revisão humana (assumir, descartar com isenção temporária, confirmar; bloqueio é decisão separada) | ✅ |
| Múltiplas contas: aparelho registrado no login (id de instalação do app / cookie do navegador, guardado como hash) e contas relacionadas | ✅ |
| Cupom de primeira compra reaproveitado no mesmo aparelho ou endereço: recusado na cotação, com sinal de risco | ✅ |
| Pedidos suspeitos: conta nova com valor alto, muitos pedidos por hora; conta de risco alto paga só online acima do limite (até a equipe liberar) | ✅ |
| Pagamentos suspeitos: recusas em sequência e vários cartões no mesmo dia | ✅ |
| Localização inconsistente: GPS simulado (flag do Android enviada pelo app), deslocamento impossível e conclusão longe do destino; entrega com GPS simulado é recusada (configurável) | ✅ |
| Cancelamentos e desistências anormais: varredura diária com desvio binomial em relação à média da plataforma | ✅ |
| Previsão de demanda por cidade e hora (sazonal ponderada + tendência, intervalo de 80%, piso pelas entregas já agendadas), precisão acompanhada (erro sobre o volume, horas dentro do intervalo) | ✅ |
| Previsão de necessidade de entregadores × presença habitual; falta prevista vira sugestão de adicional de preço, aplicada só com aprovação (adicional com data e hora sobre frete e repasse; contratos não mudam) | ✅ |
| Previsão do tempo de entrega calibrada pelo histórico (fator real por cidade/veículo/faixa horária, esperas medianas, erro antes/depois) e preparo real de cada loja usado na previsão do pedido | ✅ |
| Otimização de rotas: rota do entregador com várias entregas por vizinho mais próximo + 2-opt + or-opt, sempre com a coleta antes da entrega | ✅ |
| Anomalias: volume fora da previsão (pico/queda), picos de cancelamento e de pagamentos recusados, despacho lento — na torre de controle, com acompanhamento e encerramento automático | ✅ |
| Análise de avaliações: sentimento e temas (lista fechada) pelo léxico em tempo real e refinados pela IA em lotes; filtros no painel e resumo por loja/entregador | ✅ |
| Atendimento automatizado assistido: rascunho de resposta (IA ou modelo de texto) com resumo, prioridade sugerida e ações que dependem da equipe — nunca enviado sozinho | ✅ |
| Assistente das empresas: indicadores, previsão de 7 dias, horários de pico, recomendações por regras e perguntas em linguagem natural com ferramentas somente leitura da própria loja | ✅ |
| Provedor de IA atrás de interface (`AI_PROVIDER=none` ou `anthropic`, Claude com fallback no servidor), dados pessoais removidos antes do envio, limite diário por pessoa e registro de cada chamada | ✅ |
| Interfaces: painel (Antifraude, Inteligência, sugestão no atendimento, filtros de avaliações, alertas na torre), portal (Assistente) e app do entregador (GPS simulado) | ✅ |
| Testes: unitários (score, GPS, taxas, previsão, anomalias, rotas, léxico, dados pessoais) e E2E da inteligência (com provedor de IA simulado) | ✅ |

## Fase 9 — Escala ✅

| Item | Status |
|---|---|
| Multi-tenant: criação de tenants pelo painel com provisionamento (papéis, segmentos, preços, comissão, planos, documentos legais) e convite ao primeiro administrador; suspensão; isolamento de usuários e dados por tenant | ✅ |
| White label da plataforma: nome, cor (paleta gerada), logotipo, contatos, domínios e endereços por tenant; portal e painel com a marca do tenant; e-mails com a marca e os links do tenant; apps Android/iOS gerados por marca (nome, ícones, cores, bundle, tenant) | ✅ |
| Marca própria da empresa (plano Enterprise): cor e domínio próprio da página da loja, resolvido pelo portal | ✅ |
| Multi-cidade: cadastro de cidades com situação (em preparação, em operação, pausada), mensagem própria, bloqueio de novos pedidos e entregas fora de operação, opção de exigir cidade cadastrada, lista de espera com aviso no lançamento, indicadores por cidade e cidades com movimento sem cadastro | ✅ |
| Planos SaaS configuráveis no painel (Básico, Profissional e Enterprise de partida): recursos, limites (produtos, equipe, chaves, unidades, chamadas/minuto), preço e teste grátis | ✅ |
| Assinaturas: contratação e troca pela empresa ou pela equipe, upgrade na hora com diferença proporcional, downgrade no fim do período, cancelamento, mensalidade lançada na carteira da empresa, atraso com carência e restrição aos recursos do plano padrão, anulação de cobranças, MRR | ✅ |
| Recursos por plano aplicados em todas as rotas da empresa (a equipe da plataforma não é bloqueada), frota própria e SLA prioritário por plano; cobrança por planos desligada por padrão | ✅ |
| API pública: escopos por rota (catálogo, pedidos, entregas), recurso do plano por escopo, limite de chamadas por minuto com cabeçalhos `X-RateLimit-*`, registro de uso por chave e documentação OpenAPI própria (`/docs/public`) | ✅ |
| Webhooks: endpoints por empresa, eventos de pedidos, entregas, faturas e assinatura, assinatura HMAC com carimbo de tempo, novas tentativas com espera crescente, desativação após falhas seguidas com aviso, teste, reenvio e histórico; bloqueio de endereços internos (SSRF) | ✅ |
| Interfaces: painel (Tenants, Marca, Cidades, Planos SaaS), portal (Plano, Integrações, Marca própria, página pública da loja, Onde atendemos, planos na página para empresas) | ✅ |
| Testes: unitários (assinatura e segurança dos webhooks) e E2E da escala (tenants, cidades, planos e cobrança, API pública, webhooks e marca própria) | ✅ |
| Publicação dos apps de cada marca nas lojas (contas da própria marca) | ⏳ depende das contas de cada cliente |
