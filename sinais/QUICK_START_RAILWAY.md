# 🚀 Quick Start: Railway - Preservar Dados Entre Deploys

## ⚡ Duas Opções Disponíveis

### 🎯 Opção 1: PostgreSQL (RECOMENDADO - Mais Fácil)

Se você **não encontra "Volumes"**, use PostgreSQL:

📖 **Guia Completo**: Veja [RAILWAY_POSTGRESQL_SETUP.md](./RAILWAY_POSTGRESQL_SETUP.md)

**Resumo rápido:**
1. No projeto Railway: **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Atualizar `prisma/schema.prisma`: mudar `provider = "sqlite"` para `provider = "postgresql"`
3. Executar: `npx prisma migrate deploy`
4. Deploy
5. ✅ Pronto!

---

### 🎯 Opção 2: Volume Persistente (Se disponível)

**⚠️ ATENÇÃO**: Esta opção pode não estar disponível no seu plano.

Se você **encontrar** a opção "Volumes":

1. **Acessar o Serviço**
   - Entre no [Railway](https://railway.app)
   - Selecione seu **projeto**
   - Clique no **SERVIÇO** (geralmente "Web Service" ou nome do repo)

2. **Criar Volume**
   - No menu do serviço, procure **"Volumes"** ou **"Storage"**
   - Clique em **"+ New Volume"** ou **"Create Volume"**
   - Configure:
     ```
     Mount Path: /app/data
     Size: 1 GB
     ```
   - Clique em **"Create"**

3. **Atualizar Variável**
   - No mesmo serviço, vá em **"Variables"**
   - Procure `DATABASE_URL` ou crie nova
   - Altere o valor para:
     ```
     file:/app/data/prod.db
     ```
   - **IMPORTANTE**: Use `/app/data` (absoluto), não `./data` (relativo)

4. **Redeploy**
   - Vá em **"Deployments"**
   - Clique em **"Redeploy"** no último deploy
   - Aguarde o deploy completar

5. **Verificar**
   - Acesse: `https://seu-dominio.railway.app/api/health`
   - Deve mostrar: `fileExists: ✅` e `connection: ✅`

---

## ❓ Não Encontra "Volumes"?

**Use PostgreSQL!** É mais fácil e funciona em todos os planos.

Veja: [RAILWAY_POSTGRESQL_SETUP.md](./RAILWAY_POSTGRESQL_SETUP.md)

---

## 📋 Checklist

- [ ] Volume criado em `/app/data`
- [ ] `DATABASE_URL` = `file:/app/data/prod.db`
- [ ] Redeploy feito
- [ ] Health check OK
- [ ] Dados persistem após novo deploy

---

## ❓ Problemas?

Veja o guia completo: [RAILWAY_VOLUME_SETUP.md](./RAILWAY_VOLUME_SETUP.md)

---

**Tempo estimado**: 5 minutos  
**Dificuldade**: Fácil

