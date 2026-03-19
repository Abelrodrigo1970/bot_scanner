# 📦 Guia Completo: Configurar Volume Persistente no Railway

Este guia mostra como configurar um volume persistente no Railway para que os dados **NÃO sejam apagados** a cada deploy.

---

## ⚠️ Por que os dados são apagados?

Por padrão, o Railway recria o container a cada deploy. Sem um volume persistente, o banco SQLite é recriado e todos os dados são perdidos.

---

## ✅ Solução: Configurar Volume Persistente

### Passo 1: Acessar o Serviço no Railway

1. Acesse [railway.app](https://railway.app) e faça login
2. Selecione o seu projeto
3. **IMPORTANTE**: Clique no **SERVIÇO** (não nas configurações do projeto)
   - O serviço geralmente tem o nome do repositório ou "Web Service"

### Passo 2: Abrir a Aba "Volumes"

1. No painel do serviço, procure pela aba **"Volumes"** no menu lateral
2. Se não encontrar, procure por **"Storage"** ou **"Persistent Storage"**
3. Clique em **"Volumes"**

### Passo 3: Criar um Novo Volume

1. Clique no botão **"+ New Volume"** ou **"Create Volume"**
2. Configure o volume:
   - **Mount Path**: `/app/data`
   - **Size**: `1 GB` (ou mais, conforme necessário)
3. Clique em **"Create"** ou **"Add"**

### Passo 4: Atualizar a Variável de Ambiente

1. No mesmo serviço, vá em **"Variables"** ou **"Environment Variables"**
2. Procure pela variável `DATABASE_URL`
3. Se não existir, clique em **"+ New Variable"**
4. Configure:
   - **Nome**: `DATABASE_URL`
   - **Valor**: `file:/app/data/prod.db`
5. Clique em **"Save"** ou **"Add"**

### Passo 5: Fazer Redeploy

1. Após configurar o volume e a variável, faça um **redeploy**:
   - Vá em **"Deployments"** ou **"Deploys"**
   - Clique em **"Redeploy"** no último deploy
   - Ou faça um novo commit para trigger automático

---

## 🔍 Verificar se Funcionou

### Opção 1: Verificar Logs

1. Vá em **"Logs"** do serviço
2. Procure por mensagens como:
   - `✅ Banco de dados já existe. Pulando db push para preservar dados.`
   - `✅ Banco de dados conectado e pronto`

### Opção 2: Verificar via API Health

Acesse:
```
https://seu-dominio.railway.app/api/health
```

Deve mostrar:
- `fileExists: ✅`
- `connection: ✅ Conectado`
- `strategies: [número]` (se houver estratégias)

### Opção 3: Verificar Dados Após Deploy

1. Faça um deploy
2. Acesse a aplicação
3. Verifique se os sinais/estratégias ainda existem
4. Se existirem, está funcionando! ✅

---

## 📋 Checklist de Configuração

Marque cada item após configurar:

- [ ] Volume criado com mount path `/app/data`
- [ ] Variável `DATABASE_URL` configurada como `file:/app/data/prod.db`
- [ ] Redeploy feito após configuração
- [ ] Logs mostram que o banco existe
- [ ] Dados persistem após novo deploy

---

## 🛠️ Troubleshooting

### Problema: "Volume não aparece na lista"

**Solução:**
- Certifique-se de estar no **SERVIÇO**, não no projeto
- Alguns planos do Railway podem não ter volumes. Verifique seu plano.

### Problema: "Erro de permissão ao escrever no volume"

**Solução:**
- Verifique se o mount path está correto: `/app/data`
- O Railway deve ter permissões automáticas, mas se persistir, contate o suporte

### Problema: "Dados ainda são apagados após deploy"

**Soluções:**
1. Verifique se o volume está realmente montado:
   - Veja os logs do deploy
   - Procure por mensagens sobre o volume

2. Verifique se `DATABASE_URL` está correto:
   - Deve ser: `file:/app/data/prod.db`
   - **NÃO** deve ser: `file:./data/prod.db` (caminho relativo não funciona)

3. Verifique se o script `safe-db-push.js` está sendo usado:
   - O build deve usar: `node scripts/safe-db-push.js`
   - Verifique o `package.json`

### Problema: "Não consigo encontrar a opção Volumes"

**Soluções:**
1. Verifique se está no serviço correto (não no projeto)
2. Alguns planos podem não ter volumes. Considere:
   - Upgrade do plano
   - Usar PostgreSQL do Railway (alternativa)

---

## 🔄 Alternativa: Usar PostgreSQL do Railway

Se volumes não estiverem disponíveis, você pode usar PostgreSQL:

### Passo 1: Adicionar PostgreSQL

1. No projeto Railway, clique em **"+ New"**
2. Selecione **"Database"** → **"Add PostgreSQL"**
3. Aguarde a criação

### Passo 2: Atualizar Schema

1. Atualize `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. O Railway automaticamente fornece a `DATABASE_URL` do PostgreSQL

### Passo 3: Fazer Migração

```bash
npx prisma migrate deploy
```

---

## 📞 Precisa de Ajuda?

Se ainda tiver problemas:

1. Verifique os logs do Railway
2. Teste o endpoint `/api/health`
3. Faça um backup antes de qualquer mudança: `npm run db:backup`
4. Consulte a documentação do Railway: https://docs.railway.com

---

## ✅ Resumo Rápido

1. **Serviço** → **Volumes** → **+ New Volume**
2. Mount Path: `/app/data`
3. **Variables** → `DATABASE_URL` = `file:/app/data/prod.db`
4. **Redeploy**
5. ✅ Pronto! Dados persistem agora.

---

**Última atualização**: 22/12/2025

