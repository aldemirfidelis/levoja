# ADR 0003 — Financeiro: razão (ledger), liquidação e pagamentos

- Status: aceito
- Data: 2026-09-23

## Contexto

A plataforma movimenta dinheiro de clientes para empresas, entregadores e para a própria plataforma
(comissões e taxas), com formas de pagamento online (PIX, cartão, créditos) e em dinheiro. Precisamos de
saldos confiáveis, saques, estornos, cupons financiados por quem cria a promoção e conciliação — sem erros
de arredondamento e sem lançamentos duplicados em cenários de concorrência, retentativas e webhooks
repetidos.

## Decisões

1. **Razão imutável com sinal (`WalletTransaction`)** — toda movimentação é um lançamento com valor em
   centavos (positivo = crédito, negativo = débito). Os saldos das carteiras (`availableCents`,
   `pendingCents`) são caches atualizados na mesma transação; `recompute` e a tela de conciliação
   verificam divergências.
2. **Idempotência por `referenceKey` única** — cada evento financeiro tem uma chave determinística
   (`order:<id>:sale`, `delivery:<id>:earning`, `withdrawal:<id>`...). Reprocessar uma liquidação,
   receber o mesmo webhook duas vezes ou repetir um job nunca duplica valores.
3. **Carteiras por titular**: empresa, entregador, cliente (apenas créditos de estorno/compensação — não há
   recarga, para não configurar arranjo de pagamento) e **plataforma** (uma por tenant). A carteira da
   plataforma registra o resultado: comissões + taxas − repasses − cupons da plataforma − estornos.
4. **Fechamento**: a soma dos lançamentos de um pedido é igual ao valor recebido pelo gateway (online) ou
   zero (dinheiro — o valor recebido em mãos vira dívida de quem recebeu). Os testes E2E verificam isso.
5. **Liquidação por evento** (`order DELIVERED`, entrega avulsa concluída/falha/cancelada), com varredura
   periódica e na inicialização para reprocessar falhas. A reivindicação `settledAt IS NULL` evita
   liquidação dupla entre instâncias.
6. **Prazos de liberação** configuráveis (`finance.companyReleaseDays`, `finance.driverReleaseHours`):
   valores entram "a liberar" e um job os torna disponíveis.
7. **Comissão** por regras (empresa > segmento > padrão, vigência, prioridade) sobre as vendas menos o
   desconto em produtos bancado pela loja; frete grátis bancado pela loja não reduz a base.
8. **Débitos condicionais** (`UPDATE ... WHERE availableCents >= valor`) para saques e pagamentos com
   carteira: saldo nunca fica negativo por concorrência. Estornos reservam o valor antes de chamar o
   provedor.
9. **Gateway atrás de interface** (`PaymentGateway`): `none` (só dinheiro), `sandbox` (proibido em
   produção pela validação de ambiente) e Mercado Pago. Cartão só trafega como token do SDK do provedor
   (PCI DSS). Confirmação de pagamento apenas por webhook com assinatura verificada ou consulta ao
   provedor — nunca pelo cliente.
10. **Saques**: valor + tarifa saem do disponível na solicitação; recusa, cancelamento ou falha devolvem.
    O destino (chave PIX) é copiado criptografado no momento do pedido. Após **troca** da chave PIX, novos
    saques ficam retidos por `finance.pixKeyChangeHoldHours` (antifraude contra invasão de conta).
    Provedor `manual` (financeiro transfere e confirma com o identificador) até a integração bancária.
11. **Dinheiro em mãos**: entregadores acumulam dívida; acima de `finance.maxDriverCashDebtCents` deixam de
    receber entregas pagas em dinheiro (filtro no despacho) e podem quitar via PIX a qualquer momento.
12. **Ajustes manuais** exigem justificativa, geram contrapartida na carteira da plataforma e ficam na
    auditoria.

## Consequências

- Relatórios financeiros são consultas sobre o razão, sem recalcular pedidos.
- Toda nova regra financeira deve ser expressa como lançamentos com `referenceKey` determinística.
- Estornos após a liquidação são custo da plataforma; cobranças de responsabilidade da loja são feitas
  por ajuste manual auditado (evita débitos automáticos contestáveis).
- O faturamento mensal de entregas `INVOICE` (boleto/nota fiscal) fica para a Fase 7; até lá, o valor é
  debitado da carteira da empresa e pode ser quitado por PIX.
