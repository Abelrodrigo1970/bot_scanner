# Script para verificar e corrigir configurações de proxy do Git

Write-Host "🔍 Verificando configurações de proxy do Git..." -ForegroundColor Cyan
Write-Host ""

# Verificar configurações globais
Write-Host "📊 Configurações globais:" -ForegroundColor Yellow
$globalProxy = git config --global --get http.proxy 2>$null
$globalHttpsProxy = git config --global --get https.proxy 2>$null

if ($globalProxy) {
    Write-Host "   http.proxy: $globalProxy" -ForegroundColor Red
} else {
    Write-Host "   http.proxy: (não configurado)" -ForegroundColor Green
}

if ($globalHttpsProxy) {
    Write-Host "   https.proxy: $globalHttpsProxy" -ForegroundColor Red
} else {
    Write-Host "   https.proxy: (não configurado)" -ForegroundColor Green
}

# Verificar configurações locais
Write-Host ""
Write-Host "📊 Configurações locais:" -ForegroundColor Yellow
$localProxy = git config --local --get http.proxy 2>$null
$localHttpsProxy = git config --local --get https.proxy 2>$null

if ($localProxy) {
    Write-Host "   http.proxy: $localProxy" -ForegroundColor Red
} else {
    Write-Host "   http.proxy: (não configurado)" -ForegroundColor Green
}

if ($localHttpsProxy) {
    Write-Host "   https.proxy: $localHttpsProxy" -ForegroundColor Red
} else {
    Write-Host "   https.proxy: (não configurado)" -ForegroundColor Green
}

# Verificar se há proxy inválido (127.0.0.1:9)
$hasInvalidProxy = $false
if ($globalProxy -and $globalProxy -like "*127.0.0.1:9*") {
    Write-Host ""
    Write-Host "⚠️  PROBLEMA ENCONTRADO: Proxy inválido configurado globalmente!" -ForegroundColor Red
    $hasInvalidProxy = $true
}

if ($globalHttpsProxy -and $globalHttpsProxy -like "*127.0.0.1:9*") {
    Write-Host ""
    Write-Host "⚠️  PROBLEMA ENCONTRADO: Proxy HTTPS inválido configurado globalmente!" -ForegroundColor Red
    $hasInvalidProxy = $true
}

if ($localProxy -and $localProxy -like "*127.0.0.1:9*") {
    Write-Host ""
    Write-Host "⚠️  PROBLEMA ENCONTRADO: Proxy inválido configurado localmente!" -ForegroundColor Red
    $hasInvalidProxy = $true
}

if ($localHttpsProxy -and $localHttpsProxy -like "*127.0.0.1:9*") {
    Write-Host ""
    Write-Host "⚠️  PROBLEMA ENCONTRADO: Proxy HTTPS inválido configurado localmente!" -ForegroundColor Red
    $hasInvalidProxy = $true
}

# Verificar se há qualquer proxy configurado
$hasAnyProxy = $globalProxy -or $globalHttpsProxy -or $localProxy -or $localHttpsProxy

# Oferecer correção
if ($hasInvalidProxy -or $hasAnyProxy) {
    Write-Host ""
    Write-Host "💡 SOLUÇÃO:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Para remover as configurações de proxy e permitir conexão direta:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Deseja remover todas as configurações de proxy agora? (S/N)" -ForegroundColor Yellow
    $response = Read-Host
    
    if ($response -eq "S" -or $response -eq "s" -or $response -eq "Y" -or $response -eq "y") {
        Write-Host ""
        Write-Host "🔧 Removendo configurações de proxy..." -ForegroundColor Cyan
        
        $removed = $false
        
        if ($globalProxy) {
            git config --global --unset http.proxy 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "   ✅ http.proxy global removido" -ForegroundColor Green
                $removed = $true
            }
        }
        
        if ($globalHttpsProxy) {
            git config --global --unset https.proxy 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "   ✅ https.proxy global removido" -ForegroundColor Green
                $removed = $true
            }
        }
        
        if ($localProxy) {
            git config --local --unset http.proxy 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "   ✅ http.proxy local removido" -ForegroundColor Green
                $removed = $true
            }
        }
        
        if ($localHttpsProxy) {
            git config --local --unset https.proxy 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "   ✅ https.proxy local removido" -ForegroundColor Green
                $removed = $true
            }
        }
        
        if (-not $removed) {
            Write-Host "   ⚠️  Nenhuma configuração foi encontrada para remover" -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "✅ Configurações de proxy removidas!" -ForegroundColor Green
        }
        
        Write-Host ""
        Write-Host "🧪 Testando conexão com GitHub..." -ForegroundColor Cyan
        git ls-remote --heads origin main 2>&1 | Out-Null
        $testSuccess = $LASTEXITCODE -eq 0
        if ($testSuccess) {
            Write-Host "   ✅ Conexão com GitHub funcionando!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Agora você pode fazer o push:" -ForegroundColor Yellow
            Write-Host "   git push origin main" -ForegroundColor Gray
        } else {
            Write-Host "   ⚠️  Ainda há problemas de conexão" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "💡 Alternativa: Usar SSH em vez de HTTPS" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Deseja alterar para SSH? (S/N)" -ForegroundColor Yellow
            $useSSH = Read-Host
            
            if ($useSSH -eq "S" -or $useSSH -eq "s" -or $useSSH -eq "Y" -or $useSSH -eq "y") {
                Write-Host ""
                Write-Host "🔧 Alterando remote para SSH..." -ForegroundColor Cyan
                git remote set-url origin git@github.com:Abelrodrigo1970/crypto-sinais-automaticos.git
                Write-Host "   ✅ Remote alterado para SSH" -ForegroundColor Green
                Write-Host ""
                Write-Host "⚠️  IMPORTANTE: Certifique-se de ter configurado uma chave SSH no GitHub" -ForegroundColor Yellow
                Write-Host "   Veja: https://docs.github.com/en/authentication/connecting-to-github-with-ssh" -ForegroundColor Gray
                Write-Host ""
                Write-Host "Agora tente fazer o push:" -ForegroundColor Yellow
                Write-Host "   git push origin main" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host ""
        Write-Host "⚠️  Nenhuma alteração foi feita." -ForegroundColor Yellow
        Write-Host "Execute os comandos manualmente quando estiver pronto." -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "✅ Nenhum proxy configurado. O problema pode estar em outro lugar." -ForegroundColor Green
    Write-Host ""
    Write-Host "💡 Outras possíveis causas:" -ForegroundColor Cyan
    Write-Host "   - Firewall bloqueando conexões" -ForegroundColor Yellow
    Write-Host "   - Antivírus interferindo" -ForegroundColor Yellow
    Write-Host "   - VPN ativa" -ForegroundColor Yellow
    Write-Host "   - Problema de rede/ISP" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "💡 Alternativa: Usar SSH" -ForegroundColor Cyan
    Write-Host "   git remote set-url origin git@github.com:Abelrodrigo1970/crypto-sinais-automaticos.git" -ForegroundColor Gray
}

Write-Host ""
