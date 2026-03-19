# Guia de Deploy no Railway

## Configuração no Railway

### 1. Variáveis de Ambiente

Configure estas variáveis no Railway (Settings → Environment Variables):

```
DATABASE_URL=file:./data/prod.db
ACCESS_CODE=seu-codigo-secreto-aqui
NODE_ENV=production
```

### 2. Build Command

O Railway detecta automaticamente o Next.js e usa o comando de build do `package.json`.

### 3. Configurar Volume Persistente (IMPORTANTE!)

**⚠️ CRÍTICO: Sem um volume persistente, os dados serão perdidos a cada deploy!**

📖 **Guia Completo**: Veja [RAILWAY_VOLUME_SETUP.md](./RAILWAY_VOLUME_SETUP.md) para instruções detalhadas passo a passo.

**Resumo rápido:**

1. No Railway, vá no **SERVIÇO** (não no projeto) → **Volumes**
2. Clique em **+ New Volume**
3. Configure:
   - **Mount Path**: `/app/data`
   - **Size**: 1 GB (suficiente para muitos sinais)
4. Atualize a variável de ambiente no serviço:
   ```
   DATABASE_URL=file:/app/data/prod.db
   ```
5. Faça um **redeploy**

**Alternativa (se não usar volume):**
- Use um banco PostgreSQL externo (Railway oferece PostgreSQL como serviço)
- Atualize `prisma/schema.prisma` para usar `provider = "postgresql"`
- Configure `DATABASE_URL` com a URL do PostgreSQL

### 4. Inicialização do Banco

O banco de dados será inicializado automaticamente durante o build. O script `safe-db-push.js` preserva dados existentes.

### 5. Verificar Logs

Se houver erros:
1. Vá em "Logs" no Railway
2. Procure por mensagens de erro do Prisma
3. Verifique se o diretório `data/` foi criado

### 6. Troubleshooting

**Erro: "Database file does not exist"**
- O banco será criado automaticamente no primeiro build
- Verifique se `DATABASE_URL=file:./data/prod.db` está configurado

**Erro: "Prisma Client not generated"**
- O Prisma Client é gerado automaticamente no build
- Se persistir, adicione manualmente: `npx prisma generate`

**Erro 500 nas APIs**
- Verifique os logs do Railway
- Confirme que as variáveis de ambiente estão configuradas
- Verifique se o banco foi inicializado (deve aparecer nos logs)

**Problema: "Histórico desaparece após deploy"**
- ✅ **Solução**: Configure um volume persistente (veja seção 3 acima)
- O script de build foi atualizado para não recriar o banco se ele já existir
- Verifique se o volume está montado corretamente em `/app/data`

### 7. Primeiro Deploy

Após o primeiro deploy:
1. Acesse a URL pública do Railway
2. Faça login com o `ACCESS_CODE`
3. Clique em "Atualizar sinais agora" para testar




