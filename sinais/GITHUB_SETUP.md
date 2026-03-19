# 📤 Como Publicar no GitHub

## Passo 1: Criar Repositório no GitHub

1. Acesse [github.com](https://github.com) e faça login
2. Clique no botão **"+"** no canto superior direito
3. Selecione **"New repository"**
4. Preencha:
   - **Repository name:** `crypto-sinais-automaticos` (ou outro nome de sua preferência)
   - **Description:** "Sistema web para geração automática de sinais de compra e venda de criptomoedas"
   - **Visibility:** Escolha **Private** (recomendado) ou **Public**
   - **NÃO marque** "Initialize this repository with a README" (já temos um)
5. Clique em **"Create repository"**

## Passo 2: Conectar ao Repositório Remoto

Após criar o repositório, o GitHub mostrará instruções. Execute os comandos abaixo (substitua `SEU_USUARIO` pelo seu username do GitHub):

```bash
git remote add origin https://github.com/SEU_USUARIO/crypto-sinais-automaticos.git
git branch -M main
git push -u origin main
```

## Passo 3: Verificar

Acesse seu repositório no GitHub e verifique se todos os arquivos foram enviados corretamente.

## ⚠️ Importante

- O arquivo `.env` **NÃO** será enviado (está no .gitignore)
- O banco de dados `dev.db` **NÃO** será enviado (está no .gitignore)
- Certifique-se de que seu `ACCESS_CODE` está seguro e não foi commitado

## 🔄 Atualizações Futuras

Para enviar atualizações futuras:

```bash
git add .
git commit -m "Descrição das alterações"
git push
```

