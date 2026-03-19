# 📥 Como Importar Histórico do Backup para PostgreSQL

## 🎯 Objetivo

Importar os dados do backup SQLite (25 sinais) para o PostgreSQL no Railway.

---

## 🚀 Método 1: Importar Localmente (Recomendado)

### Passo 1: Obter DATABASE_URL do Railway

1. No Railway, vá no serviço **Postgres**
2. Vá em **"Variables"** ou **"Connect"**
3. Copie a `DATABASE_URL` (começa com `postgresql://`)

### Passo 2: Executar Importação

**Opção A: Passar URL como argumento**
```bash
node scripts/import-backup-to-postgres.js "backups/backup-2025-12-22T21-25-59.db" "postgresql://postgres:senha@host:port/db"
```

**Opção B: Configurar variável de ambiente**

No PowerShell (Windows):
```powershell
$env:DATABASE_URL="postgresql://postgres:senha@host:port/db"
node scripts/import-backup-to-postgres.js
```

Ou crie um arquivo `.env.local` (não será commitado):
```
DATABASE_URL=postgresql://postgres:senha@host:port/db
```

Depois execute:
```bash
node scripts/import-backup-to-postgres.js
```

### Passo 4: Verificar

O script mostrará:
- Quantas estratégias foram importadas
- Quantos sinais foram importados
- Total de sinais no PostgreSQL

---

## 🚀 Método 2: Via API no Railway

Após fazer login na aplicação, você pode chamar:

```bash
POST https://seu-dominio.railway.app/api/import-backup
Content-Type: application/json
Cookie: auth-token=seu-token

{
  "backupFile": "backup-2025-12-22T21-25-59.db"
}
```

**Nota**: O backup precisa estar no diretório `backups/` do projeto. Para usar este método, você precisaria fazer upload do backup primeiro.

---

## 📋 Checklist

- [ ] DATABASE_URL do PostgreSQL copiada do Railway
- [ ] Variável de ambiente configurada localmente
- [ ] Backup disponível em `backups/`
- [ ] Script executado: `node scripts/import-backup-to-postgres.js`
- [ ] Dados verificados no Railway

---

## ⚠️ Importante

- O script **não duplica** dados (verifica se já existem)
- Estratégias são atualizadas se já existirem
- Sinais são importados apenas se não existirem
- Todos os dados são preservados

---

## 🔍 Verificar Após Importação

1. Acesse a aplicação no Railway
2. Vá em "Histórico"
3. Deve ver os 25 sinais importados

Ou use Prisma Studio:
```bash
DATABASE_URL=postgresql://... npx prisma studio
```

---

**Pronto para importar!** 🚀

