# Plano de Implementação: Bot de Trading Volume Spike

Este plano divide a implementação em fases para evitar confusão e problemas. Cada fase é independente e testável antes de passar à seguinte.

---

## Fase 0: Pré-requisitos (sem alterar código)

- [ ] Criar conta no [Binance Futures Testnet](https://testnet.binancefuture.com)
- [ ] Gerar API Key e Secret no Testnet
- [ ] Anotar as credenciais para usar em variáveis de ambiente

**Variáveis que vais precisar:**
```
BINANCE_API_KEY=xxx
BINANCE_API_SECRET=xxx
BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com
TRADING_ENABLED=false
POSITION_SIZE_USDT=100
```

---

## Fase 1: Cliente Binance (sem tocar em sinais)

**Objetivo:** Ter um cliente que consegue fazer chamadas autenticadas à API Futures.

**Ficheiros novos:**
- `lib/binanceConfig.ts` – URL base e validação de variáveis
- `lib/binanceFuturesClient.ts` – Funções para `POST /fapi/v1/order`, `GET /fapi/v1/positionRisk`, etc.

**O que NÃO fazer:**
- Não alterar schema
- Não alterar APIs de sinais
- Não criar endpoints de execução ainda

**Teste:** Script simples que faz `GET /fapi/v1/positionRisk` e imprime o resultado (ou vazio se não houver posições).

**Deploy:** Podes fazer push. O cliente não é chamado por nada ainda, é código morto até à Fase 2.

---

## Fase 2: Regras de Trading

**Objetivo:** Definir a lógica de execução sem executar nada.

**Ficheiro novo:**
- `lib/tradingRules.ts` – Funções como `canExecuteSignal(signal)` (força ≥ 70, Volume Spike, etc.), `calculatePositionSize()`, `getStopLossOrderParams()`, etc.

**O que NÃO fazer:**
- Não criar ordens reais
- Não alterar a base de dados

**Teste:** Função que recebe um sinal mock e devolve os parâmetros da ordem (quantidade, preços, etc.).

**Deploy:** Seguro. Só lógica pura.

---

## Fase 3: Executor (apenas logs, sem ordens)

**Objetivo:** Fluxo completo de “execução” mas só com `console.log`, sem chamadas à Binance.

**Ficheiro novo:**
- `lib/tradingExecutor.ts` – Função `executeSignal(signal)` que:
  1. Verifica regras
  2. Calcula parâmetros
  3. Faz **log** do que faria (ex: "Ordem: BUY BTCUSDT, qty X, SL Y, TP Z")
  4. **Não** chama a API

**Teste:** Endpoint ou script que busca 1 sinal NEW de Volume Spike e chama `executeSignal` – verificar os logs.

**Deploy:** Seguro. Nada é executado na Binance.

---

## Fase 4: Endpoint de Execução Manual (Testnet)

**Objetivo:** Botão na UI que executa 1 sinal de verdade no Testnet.

**Ficheiros:**
- `app/api/execute-trade/route.ts` – POST que recebe `signalId`, chama o executor real
- Atualizar `lib/tradingExecutor.ts` – Agora chama `binanceFuturesClient` de verdade
- Atualizar `app/sinais/[id]/page.tsx` – Botão "Executar trade" (só visível se `TRADING_ENABLED=true`)

**Proteções:**
- `TRADING_ENABLED` deve estar `true` para executar
- Verificar que `BINANCE_FUTURES_BASE_URL` é Testnet
- Validar que o sinal é Volume Spike e força ≥ 70

**O que NÃO fazer (ainda):**
- Não alterar o schema do `Signal` (sem `executedAt`, `executionOrderId`)
- Podes guardar execuções numa tabela nova `ExecutedTrade` se quiseres histórico, mas **não** mexer na tabela `Signal`

**Teste:** 
1. Criar um sinal Volume Spike com força 70+
2. Clicar em "Executar trade" na página do sinal
3. Verificar na conta Testnet que a ordem foi aberta

**Deploy:** Com `TRADING_ENABLED=false` no Railway, o botão não aparece ou está desativado. Sem risco.

---

## Fase 5: Schema Opcional (só se precisares)

**Objetivo:** Guardar referência da ordem no sinal, para evitar duplicados e mostrar "Executado" na UI.

**Alterações:**
- Adicionar `executedAt` e `executionOrderId` ao modelo `Signal` (opcionais)
- Migração: `npx prisma migrate dev` (não `db push` em produção)

**Importante:**
- A API `/api/signals` deve continuar a funcionar **sem** estas colunas (usar `select` explícito que as omita, ou garantir que existem na BD antes de as usar)
- Aplicar migração manualmente no Railway antes de fazer deploy do código que as usa

**Teste:** Após migração, executar um trade e verificar que `executedAt` e `executionOrderId` são preenchidos.

---

## Fase 6: Cron para Fechar TP (opcional)

**Objetivo:** Fechar TP2/TP3 automaticamente (ex: 24h após entrada).

**Ficheiro:**
- `app/api/cron/run-tp-closes/route.ts` – Cron que busca posições abertas há X horas e fecha

**Proteções:**
- Mesmo `TRADING_ENABLED` e validação de Testnet
- Rate limiting para não exceder limites da API

---

## Resumo de Segurança

| Fase | Risco para dados/sinais | Mitigação |
|------|--------------------------|-----------|
| 1-3  | Nenhum                   | Código isolado, sem efeitos colaterais |
| 4    | Baixo                    | Só Testnet, `TRADING_ENABLED` controla |
| 5    | Médio (schema)           | Migração explícita, API resiliente |
| 6    | Baixo                    | Cron protegido, mesmo controlo |

---

## Ordem Recomendada

1. Fase 0 → 1 → 2 → 3 (implementar e fazer push)
2. Testar Fase 3 localmente
3. Fase 4 (endpoint + botão), testar no Testnet
4. Só depois: Fase 5 se precisares de `executedAt`/`executionOrderId`
5. Fase 6 quando o fluxo básico estiver estável

---

## Checklist Final Antes de Mainnet

- [ ] Testes completos no Testnet
- [ ] `BINANCE_FUTURES_BASE_URL=https://fapi.binance.com` (mainnet)
- [ ] API Key e Secret da conta real (com permissão Futures)
- [ ] `TRADING_ENABLED=true` só quando estiveres confiante
- [ ] Position size e número máximo de posições configurados
- [ ] Stop Loss sempre ativo em todas as ordens
