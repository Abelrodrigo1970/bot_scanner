# ⏰ Configuração do Cron Job Automático

Sistema RSI + Volume Spike. Executa automaticamente entre 8:00 e 23:59.

## Endpoints disponíveis (3 cron jobs)

| Endpoint | Estratégias | Tempo estimado |
|----------|-------------|----------------|
| `/api/cron/run-signals` | RSI | ~5-10 min |
| `/api/cron/run-volume-spike` | Volume Spike 1h (400 símbolos, background) | Resposta imediata |
| `/api/cron/run-volume-spike-15m` | Volume Spike 15m (400 símbolos, background) | Resposta imediata |

**Configuração:** Crie 3 cron jobs no cron-job.org.

## Horários de Execução

- **8:00** - Primeira execução do dia
- **9:00** - Segunda execução
- **10:00** - Terceira execução
- ...
- **23:00** - Última execução do dia

**Total:** 16 execuções por dia (8:00 até 23:00)

## Configuração no cron-job.org (Recomendado)

### Passo 1: Criar Conta
1. Acesse: https://cron-job.org
2. Crie uma conta gratuita

### Passo 2: Criar os 3 Cron Jobs

**Cron Job 1 – RSI:**
- **Title:** Sinais RSI
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-signals`
- **Schedule:** `0 8-23 * * *` (hora a hora 8h–23h)
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET` (se configurado)

**Cron Job 2 – Volume Spike 1h:**
- **Title:** Sinais Volume Spike 1h
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-volume-spike`
- **Schedule:** `0 8-23 * * *` (hora a hora)
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET`

**Cron Job 3 – Volume Spike 15m:**
- **Title:** Sinais Volume Spike 15m
- **URL:** `https://SEU-DOMINIO.up.railway.app/api/cron/run-volume-spike-15m`
- **Schedule:** `*/15 8-23 * * *` (a cada 15 min, 8h–23h)
- **Method:** GET
- **Headers:** `Authorization: Bearer SEU_CRON_SECRET`

### Passo 3: Testar
1. Clique em "Run now" para testar
2. Verifique os logs no Railway

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

**RSI:**
```
https://SEU-DOMINIO.up.railway.app/api/cron/run-signals
```

**Volume Spike 1h:**
```
https://SEU-DOMINIO.up.railway.app/api/cron/run-volume-spike
```

**Volume Spike 15m:**
```
https://SEU-DOMINIO.up.railway.app/api/cron/run-volume-spike-15m
```

**Respostas esperadas:**
- ✅ **200 OK:** Executado com sucesso (se estiver entre 8:00-23:59)
- ⚠️ **200 OK (fora do horário):** Mensagem informando que está fora do horário
- ❌ **401:** Não autorizado (se CRON_SECRET estiver configurado e não fornecido)
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

### Opção 3: GitHub Actions (se o código estiver no GitHub)
- Pode criar um workflow que executa a cada hora
- Gratuito para repositórios públicos

## Troubleshooting

### Erro 502 Bad Gateway / Cron desativado
- **Causa:** Timeout - o endpoint demorou demais (Railway ~60-300s)
- **Solução:** Use `/api/cron/run-volume-spike` em vez de `/api/cron/run-signals`
- Reative o cron no cron-job.org e altere a URL

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

