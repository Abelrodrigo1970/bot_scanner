# Como Publicar no GitHub

## Passo 1: Criar Repositório no GitHub

1. Acesse https://github.com/new
2. Preencha:
   - **Repository name**: `crypto-sinais-automaticos` (ou outro nome de sua escolha)
   - **Description**: "Sistema de sinais automáticos de criptomoedas"
   - **Visibility**: Escolha **Private** (recomendado) ou **Public**
   - **NÃO marque** "Initialize this repository with a README"
3. Clique em **"Create repository"**

## Passo 2: Conectar e Fazer Push

Depois de criar o repositório, execute os comandos abaixo no terminal:

```bash
# Adicionar o repositório remoto (substitua SEU_USUARIO pelo seu username do GitHub)
git remote add origin https://github.com/SEU_USUARIO/crypto-sinais-automaticos.git

# Ou se preferir usar SSH:
# git remote add origin git@github.com:SEU_USUARIO/crypto-sinais-automaticos.git

# Renomear branch para main (se necessário)
git branch -M main

# Fazer push do código
git push -u origin main
```

## Alternativa: Usar GitHub CLI

Se você tem o GitHub CLI instalado:

```bash
gh repo create crypto-sinais-automaticos --private --source=. --remote=origin --push
```

## Importante

- O arquivo `.env` com seu código de acesso **NÃO será enviado** (está no .gitignore)
- O banco de dados `dev.db` **NÃO será enviado** (está no .gitignore)
- Apenas o código fonte será publicado






