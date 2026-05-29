# ⏰ Configuração do Cron Job Automático

Sistema de sinais. **Timezone no cron-job.org:** `Europe/Lisbon` (Portugal).

## Rentabilidade (MA Cross 15m + Pivot Boss 15m)

Análise histórica (2026, força ≥70, dias úteis):

| Estratégia | Guards no código | Cron recomendado | PnL simulado |
|---|---|---|---|
| **MA Cross 15m** | Whitelist **3, 7, 15, 17, 19h** PT + sem FDS + turnover **≥ $10M/h** | **`*/15 * * * *`** (24h) | ~+$464 vs +$268 só 8–23h |
| **Pivot Boss 15m** | Bloqueio **18h, 22h** PT + sem FDS + turnover **≤ $5M/h** | **`0 * * * *`** (24h) | ~+$517 vs +$325 só 8–23h |

O código filtra horas más; o cron **24h** permite captar **3h/7h** (MA Cross) e **0h–7h** (Pivot Boss).

## Endpoints disponíveis (modo agregado)

| Endpoint | Estratégias | Frequência recomendada |
|----------|-------------|------------------------|
| `/api/cron/run-15m` | MA Cross 15m + EMA Ribbon SELL 15m | **`*/15 * * * *`** (24h) |
| `/api/cron/run-30m` | **Afastamento médio 30m** | `*/30 8-23 * * *` |
| `/api/cron/run-1h` | Pivot Boss 15m/1h, RSI 1h, MA200 4h, MACD+PMO | **`0 * * * *`** (24h) |
| `/api/cron/run-universe-scans` | Scanners 1, 2 e 3 (universo) | `0 */4 * * *` (de 4 em 4 h, 24h) |

**Importante:** `AFASTAMENTO_MEDIO_30M` **não** corre no `run-1h` nem no `run-signals`. Precisa do job **30m** separado.

**Configuração mínima no cron-job.org:** 3 jobs (15m + **30m** + 1h) + 1 job para scanners (opcional mas recomendado).

## Horários de Execução (24h — MA Cross + Pivot Boss)

- **15m:** :00, :15, :30, :45 de cada hora (MA Cross só gera sinal às 3, 7, 15, 17, 19h PT)
- **30m:** :00 e :30 de cada hora ← **Afastamento 30m** (pode manter 8–23h)
- **1h:** início de cada hora (Pivot Boss activo 0–23h excepto 18h e 22h PT)
- **Scanners:** de 4 em 4 horas

## Configuração no cron-job.org (Recomendado)

### Passo 1: Criar Conta
1. Acesse: https://cron-job.org
2. Crie uma conta gratuita

### Passo 2: Criar os Cron Jobs

**Cron Job 1 – Agregado 15m (24h — MA Cross whitelist filtra horas):**
- **Title:** Sinais 15m
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-15m`
- **Schedule:** `*/15 * * * *`
- **Timezone:** Europe/Lisbon
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET`

**Cron Job 2 – Agregado 30m (obrigatório para Afastamento 30m):**
- **Title:** Sinais 30m (Afastamento)
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-30m`
- **Schedule:** `*/30 8-23 * * *`
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET`

**Cron Job 3 – Agregado 1h (24h — Pivot Boss bloqueia 18h/22h no código):**
- **Title:** Sinais 1h
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-1h`
- **Schedule:** `0 * * * *`
- **Timezone:** Europe/Lisbon
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET`

**Cron Job 4 – Scanners universo (recomendado):**
- **Title:** Scanners 1/2/3
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-universe-scans`
- **Schedule:** `0 */4 * * *`
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET`

### Passo 3: Testar
1. Clique em "Run now" no job 30m
2. Verifique os logs no Railway: `[Run-30m BG]` e `[Afastamento-30m BG] Concluído`

## Configuração de Segurança (Opcional mas Recomendado)

### Adicionar CRON_SECRET no Railway

1. No Railway, vá em Settings → Environment Variables
2. Adicione:
   ```
   CRON_SECRET=seu-token-super-secreto-aqui
   ```
3. Use este token no header Authorization do cron-job.org

## Verificação Manual

Substitua `SEU-DOMINIO` pelo domínio do seu projeto Railway.

```
https://SEU-DOMINIO.up.railway.app/api/cron/run-15m
https://SEU-DOMINIO.up.railway.app/api/cron/run-30m
https://SEU-DOMINIO.up.railway.app/api/cron/run-1h
https://SEU-DOMINIO.up.railway.app/api/cron/run-universe-scans
```

Endpoint directo (equivalente ao que o run-30m chama):
```
https://SEU-DOMINIO.up.railway.app/api/cron/run-afastamento-30m
```

**Respostas esperadas:**
- ✅ **200 OK:** Processamento iniciado em background
- ❌ **401:** Não autorizado (CRON_SECRET em falta ou incorrecto)
- ❌ **500:** Erro na execução

## Alternativas ao cron-job.org

### Opção 1: EasyCron
- URL: https://www.easycron.com
- Similar ao cron-job.org
- Plano gratuito disponível

### Opção 2: UptimeRobot
- URL: https://uptimerobot.com
- Monitora e pode executar URLs
- Plano gratuito disponível

## Troubleshooting

### Afastamento 30m nunca gera sinais
1. Confirme que existe o cron **`run-30m`** com `*/30` (não basta o job 1h)
2. Confirme que o **Scanner 3** corre (`run-universe-scans`)
3. Nos logs Railway procure `[Afastamento-30m BG] Concluído`

### Erro 502 Bad Gateway / Cron desativado
- **Causa:** Timeout - o endpoint demorou demais (Railway ~60-300s)
- **Solução:** Os endpoints agregados respondem 200 imediato e correm em background
- Reative o cron no cron-job.org

### Cron não está executando
1. Verifique se o cron-job.org está ativo
2. Verifique os logs do cron-job.org
3. Verifique os logs do Railway
4. Teste manualmente a URL

### Erro 401 (Não autorizado)
- Verifique se o CRON_SECRET está configurado corretamente
- Verifique se o header Authorization está sendo enviado

### Executa fora do horário
- Verifique o timezone do servidor
- O código usa UTC por padrão
- Ajuste o horário no cron-job.org se necessário
