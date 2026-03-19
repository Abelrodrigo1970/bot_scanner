# 📦 Sistema de Backup do Banco de Dados

Este projeto inclui um sistema completo de backup para preservar todos os dados (estratégias e sinais) do banco de dados SQLite.

## 🚀 Como Fazer Backup

### Opção 1: Via Linha de Comando

```bash
npm run db:backup
```

Ou diretamente:

```bash
node scripts/backup-db.js
```

### Opção 2: Via API (Web)

Se a aplicação estiver rodando:

```bash
# Criar backup
curl -X POST http://localhost:3000/api/backup \
  -H "Cookie: auth-token=seu-token"

# Listar backups
curl http://localhost:3000/api/backup \
  -H "Cookie: auth-token=seu-token"
```

No Railway, use a URL do seu domínio:
```
https://seu-dominio.railway.app/api/backup
```

## 📁 Localização dos Backups

Os backups são salvos em:
- **Local**: `./backups/backup-YYYY-MM-DDTHH-MM-SS.db`
- **Railway**: `/app/backups/backup-YYYY-MM-DDTHH-MM-SS.db`

## 🔄 Como Restaurar um Backup

### Opção 1: Via Linha de Comando (Interativo)

```bash
npm run db:restore
```

O script irá:
1. Listar todos os backups disponíveis
2. Pedir para você escolher qual restaurar
3. Criar um backup do banco atual antes de restaurar (segurança)
4. Restaurar o backup escolhido

### Opção 2: Restaurar Backup Específico

```bash
node scripts/restore-db.js backup-2025-12-22T21-21-53.db
```

## ⚠️ Importante

1. **Antes de cada deploy no Railway**: Faça um backup manual via API ou linha de comando
2. **Backups automáticos**: Considere configurar um cron job para fazer backups periódicos
3. **Armazenamento**: Os backups são salvos localmente. Para produção, considere:
   - Fazer download dos backups do Railway periodicamente
   - Usar um serviço de armazenamento (S3, Google Drive, etc.)
   - Configurar backup automático no Railway

## 📊 Verificar Backups

Para ver todos os backups disponíveis:

```bash
ls -lh backups/
```

Ou via API:

```bash
curl http://localhost:3000/api/backup
```

## 🔒 Segurança

- Os backups contêm todos os dados do banco (incluindo estratégias e sinais)
- Mantenha os backups em local seguro
- Não commite backups no Git (já estão no `.gitignore`)
- Considere criptografar backups sensíveis

## 🛠️ Troubleshooting

**Erro: "Banco de dados não encontrado"**
- Verifique se `DATABASE_URL` está configurado corretamente
- Verifique se o banco existe em `./data/prod.db` ou `./prisma/dev.db`

**Erro: "Permissão negada"**
- Verifique permissões de escrita no diretório `backups/`
- No Railway, certifique-se de que o volume tem permissões corretas

**Backup muito grande**
- SQLite pode crescer com o tempo
- Considere fazer limpeza periódica de sinais antigos
- Use `VACUUM` no SQLite para compactar o banco

