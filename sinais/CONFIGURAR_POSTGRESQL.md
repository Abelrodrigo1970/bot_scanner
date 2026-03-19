# 🐘 Configurar PostgreSQL - Passo a Passo

## Situação Atual

- ✅ Schema já está configurado para PostgreSQL
- ❌ `DATABASE_URL` local ainda aponta para SQLite
- ⚠️ Precisa configurar PostgreSQL no Railway primeiro

---

## 🚀 Solução: Configurar no Railway Primeiro

### Passo 1: Adicionar PostgreSQL no Railway

1. No Railway, vá no seu **projeto**
2. Clique em **"+ New"** (canto superior direito)
3. Selecione **"Database"**
4. Escolha **"Add PostgreSQL"**
5. Aguarde alguns segundos ⏳

### Passo 2: Copiar DATABASE_URL do Railway

1. Após criar o PostgreSQL, clique no serviço do **PostgreSQL**
2. Vá em **"Variables"** ou **"Connect"**
3. Copie a `DATABASE_URL` (algo como: `postgresql://user:pass@host:port/db`)

### Passo 3: Configurar Localmente (Temporário)

**Opção A: Usar a URL do Railway localmente**

Crie um arquivo `.env.local` (não será commitado):

```bash
DATABASE_URL=postgresql://user:pass@host:port/db
```

Substitua pelos valores reais do Railway.

**Opção B: Usar PostgreSQL Local**

Se você tem PostgreSQL instalado localmente:

```bash
DATABASE_URL=postgresql://postgres:senha@localhost:5432/sinais
```

### Passo 4: Fazer Migração

Agora você pode executar:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Isso criará as tabelas no PostgreSQL.

### Passo 5: Fazer Seed (Opcional)

```bash
npm run db:seed
```

### Passo 6: Fazer Deploy

1. Commit e push
2. O Railway fará deploy automaticamente
3. ✅ Pronto!

---

## 🔄 Alternativa: Desenvolver com SQLite Localmente

Se você quer continuar usando SQLite localmente e PostgreSQL no Railway:

### Passo 1: Reverter Schema Temporariamente

```bash
# Reverter para SQLite localmente
git checkout prisma/schema.prisma
# Ou editar manualmente: provider = "sqlite"
```

### Passo 2: Desenvolver Localmente

```bash
DATABASE_URL=file:./prisma/dev.db
npm run dev
```

### Passo 3: Antes de Fazer Deploy

```bash
# Migrar para PostgreSQL
npm run db:migrate-to-postgres
npx prisma generate
# Fazer commit e push
```

---

## 💡 Recomendação

**Use PostgreSQL tanto localmente quanto no Railway!**

1. Instale PostgreSQL localmente (ou use Docker)
2. Configure `DATABASE_URL` local
3. Faça migração
4. Desenvolva normalmente
5. No Railway, use o PostgreSQL do Railway

---

## 🛠️ Instalar PostgreSQL Localmente (Windows)

### Opção 1: Docker (Mais Fácil)

```bash
docker run --name postgres-sinais -e POSTGRES_PASSWORD=senha123 -e POSTGRES_DB=sinais -p 5432:5432 -d postgres
```

Depois configure:
```
DATABASE_URL=postgresql://postgres:senha123@localhost:5432/sinais
```

### Opção 2: Instalar PostgreSQL

1. Baixe de: https://www.postgresql.org/download/windows/
2. Instale
3. Configure:
   ```
   DATABASE_URL=postgresql://postgres:sua-senha@localhost:5432/sinais
   ```

---

## ✅ Checklist

- [ ] PostgreSQL criado no Railway
- [ ] `DATABASE_URL` copiada do Railway
- [ ] `.env.local` criado com a URL do Railway (ou PostgreSQL local)
- [ ] `npx prisma generate` executado
- [ ] `npx prisma migrate dev --name init` executado
- [ ] `npm run db:seed` executado (opcional)
- [ ] Deploy feito
- [ ] Dados persistem ✅

---

**Agora você pode executar a migração sem erros!** 🚀

