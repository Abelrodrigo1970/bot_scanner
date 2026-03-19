# Solução para Problema de Proxy do Git

## Problema Identificado

O erro `Failed to connect to 127.0.0.1 port 9` indica que há um problema de conexão, mas **não é um proxy configurado no Git**.

## Diagnóstico Realizado

✅ **Verificado**: Não há configurações de proxy no Git (global ou local)
❌ **Problema**: Ainda assim, a conexão HTTPS com GitHub falha
❌ **SSH**: Também não funciona (provavelmente falta chave SSH configurada)

## Possíveis Causas

1. **Firewall do Windows** bloqueando conexões HTTPS
2. **Antivírus** interferindo nas conexões
3. **VPN ativa** que está bloqueando
4. **Proxy de rede corporativa** (mesmo que não esteja configurado no Git)
5. **Problema de rede/ISP**

## Soluções Possíveis

### Opção 1: Verificar Firewall

1. Abra "Firewall do Windows Defender"
2. Verifique se há regras bloqueando o Git
3. Tente desabilitar temporariamente para testar

### Opção 2: Configurar Chave SSH (Recomendado)

SSH geralmente funciona melhor que HTTPS em redes restritivas:

1. **Gerar chave SSH** (se ainda não tiver):
   ```powershell
   ssh-keygen -t ed25519 -C "seu-email@exemplo.com"
   ```

2. **Adicionar chave ao ssh-agent**:
   ```powershell
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```

3. **Copiar chave pública**:
   ```powershell
   cat ~/.ssh/id_ed25519.pub
   ```

4. **Adicionar no GitHub**:
   - Vá em GitHub → Settings → SSH and GPG keys
   - Clique em "New SSH key"
   - Cole a chave pública

5. **Alterar remote para SSH**:
   ```powershell
   git remote set-url origin git@github.com:Abelrodrigo1970/crypto-sinais-automaticos.git
   ```

6. **Testar**:
   ```powershell
   git push origin main
   ```

### Opção 3: Usar GitHub Desktop ou GitHub CLI

- **GitHub Desktop**: Interface gráfica que geralmente funciona melhor
- **GitHub CLI**: `gh auth login` e depois `gh repo sync`

### Opção 4: Push Manual via Interface Web

Como alternativa temporária, você pode:
1. Fazer commit localmente
2. Criar um arquivo ZIP do código
3. Fazer upload manual no GitHub (não ideal, mas funciona)

## Script Criado

Foi criado o script `scripts/fix-git-proxy-simple.ps1` que:
- Verifica configurações de proxy
- Remove proxies inválidos
- Testa conexão com GitHub

Execute com:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/fix-git-proxy-simple.ps1
```

## Status Atual

- ✅ Script de diagnóstico criado
- ✅ Remote configurado (HTTPS)
- ❌ Push ainda falha (problema de rede/firewall)
- ⚠️ SSH não configurado (precisa de chave SSH)

## Próximos Passos Recomendados

1. **Configurar SSH** (mais confiável)
2. Ou verificar **Firewall/Antivírus**
3. Ou usar **GitHub Desktop** como alternativa
