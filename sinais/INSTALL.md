# Guia de Instalação - Crypto Sinais Automáticos

## Pré-requisitos

- Node.js 18+ instalado
- npm ou yarn

## Passo a Passo

### 1. Instalar Dependências

```bash
npm install
```

### 2. Configurar Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto (copie do `.env.example`):

```bash
cp .env.example .env
```

Edite o arquivo `.env` e configure:

```env
DATABASE_URL="file:./dev.db"
ACCESS_CODE="seu-codigo-secreto-aqui"
```

**Importante:** Altere o `ACCESS_CODE` para um código seguro que você e seus amigos usarão para fazer login.

### 3. Configurar Banco de Dados

Execute os seguintes comandos para criar o banco de dados e gerar o cliente Prisma:

```bash
npm run db:push
npm run db:generate
```

### 4. Popular Estratégias Iniciais

Execute o seed para criar as estratégias padrão (RSI, MA Crossover, MACD):

```bash
npm run db:seed
```

### 5. Iniciar o Servidor

```bash
npm run dev
```

O servidor estará disponível em [http://localhost:3000](http://localhost:3000)

## Primeiro Acesso

1. Acesse [http://localhost:3000](http://localhost:3000)
2. Você será redirecionado para a página de login
3. Digite o código de acesso configurado no `.env`
4. Após o login, você verá o dashboard

## Gerar Sinais

1. No dashboard, clique em "Atualizar sinais agora"
2. O sistema irá:
   - Buscar dados de mercado da API pública da Binance
   - Executar todas as estratégias ativas
   - Gerar sinais quando as condições forem atendidas
   - Salvar os sinais no banco de dados

## Gerenciar Estratégias

1. Acesse a página "Estratégias" no menu
2. Você pode:
   - Ativar/desativar estratégias
   - Ajustar parâmetros (período RSI, médias móveis, etc.)
   - Ver descrições de cada estratégia

## Estrutura do Banco de Dados

O banco de dados SQLite será criado em `prisma/dev.db`. Você pode visualizar e editar usando:

```bash
npm run db:studio
```

## Troubleshooting

### Erro ao buscar dados da API

- Verifique sua conexão com a internet
- A API da Binance pode estar temporariamente indisponível
- Aguarde alguns segundos e tente novamente

### Erro de autenticação

- Verifique se o `ACCESS_CODE` no `.env` está correto
- Certifique-se de que o arquivo `.env` existe na raiz do projeto

### Erro ao gerar sinais

- Verifique se há estratégias ativas na página de Estratégias
- Verifique os logs do console para mais detalhes
- Certifique-se de que o banco de dados foi criado corretamente






