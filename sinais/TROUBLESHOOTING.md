# 🔧 Troubleshooting - Erros 500

## Diagnóstico Rápido

### 1. Verificar Health Check

Acesse no navegador (substitua pela sua URL):
```
https://seu-dominio.up.railway.app/api/health
```

Isso mostrará:
- ✅/❌ Status das variáveis de ambiente
- ✅/❌ Status do banco de dados
- ✅/❌ Se o diretório data/ existe
- ✅/❌ Se consegue conectar ao banco

### 2. Inicializar Banco Manualmente

Se o banco não foi criado, acesse:
```
https://seu-dominio.up.railway.app/api/init-db
```

Faça uma requisição POST (use Postman, curl, ou o console do navegador):
```javascript
fetch('/api/init-db', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```

### 3. Verificar Variáveis de Ambiente no Railway

No Railway:
1. Vá em Settings → Environment Variables
2. Verifique se estão configuradas:
   - `DATABASE_URL=file:./data/prod.db`
   - `ACCESS_CODE=seu-codigo`
   - `NODE_ENV=production` (opcional)

### 4. Verificar Logs do Railway

No Railway:
1. Vá na aba "Logs"
2. Procure por:
   - "Verificando banco de dados..."
   - "Banco de dados criado com sucesso!"
   - Erros do Prisma
   - Erros de permissão

### 5. Problemas Comuns

#### Erro: "Database file does not exist"
**Solução:**
- Acesse `/api/init-db` via POST
- Ou verifique se o script `ensure-db.js` está rodando no startup

#### Erro: "Prisma Client not generated"
**Solução:**
- O Prisma Client deve ser gerado no build
- Verifique os logs do build no Railway

#### Erro: "Permission denied"
**Solução:**
- O Railway deve ter permissão de escrita
- Verifique se o diretório `data/` pode ser criado

#### Erro 500 persistente
**Solução:**
1. Acesse `/api/health` para diagnóstico
2. Verifique os logs do Railway
3. Tente inicializar manualmente via `/api/init-db`

## Comandos Úteis

### Verificar Health
```bash
curl https://seu-dominio.up.railway.app/api/health
```

### Inicializar Banco
```bash
curl -X POST https://seu-dominio.up.railway.app/api/init-db
```

## Próximos Passos

Se ainda não funcionar:
1. Copie a saída de `/api/health`
2. Copie os logs do Railway
3. Envie para análise






