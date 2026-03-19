# Script simples para remover configuracoes de proxy do Git

Write-Host "Verificando e corrigindo configuracoes de proxy do Git..." -ForegroundColor Cyan
Write-Host ""

# Verificar e remover proxy global
$globalProxy = git config --global --get http.proxy 2>$null
$globalHttpsProxy = git config --global --get https.proxy 2>$null

if ($globalProxy) {
    Write-Host "Proxy global encontrado: $globalProxy" -ForegroundColor Yellow
    git config --global --unset http.proxy 2>$null
    Write-Host "   http.proxy global removido" -ForegroundColor Green
}

if ($globalHttpsProxy) {
    Write-Host "Proxy HTTPS global encontrado: $globalHttpsProxy" -ForegroundColor Yellow
    git config --global --unset https.proxy 2>$null
    Write-Host "   https.proxy global removido" -ForegroundColor Green
}

# Verificar e remover proxy local
$localProxy = git config --local --get http.proxy 2>$null
$localHttpsProxy = git config --local --get https.proxy 2>$null

if ($localProxy) {
    Write-Host "Proxy local encontrado: $localProxy" -ForegroundColor Yellow
    git config --local --unset http.proxy 2>$null
    Write-Host "   http.proxy local removido" -ForegroundColor Green
}

if ($localHttpsProxy) {
    Write-Host "Proxy HTTPS local encontrado: $localHttpsProxy" -ForegroundColor Yellow
    git config --local --unset https.proxy 2>$null
    Write-Host "   https.proxy local removido" -ForegroundColor Green
}

if (-not $globalProxy -and -not $globalHttpsProxy -and -not $localProxy -and -not $localHttpsProxy) {
    Write-Host "Nenhum proxy configurado encontrado" -ForegroundColor Green
}

Write-Host ""
Write-Host "Testando conexao com GitHub..." -ForegroundColor Cyan
git ls-remote --heads origin main 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "   Conexao com GitHub funcionando!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Agora voce pode fazer o push:" -ForegroundColor Yellow
    Write-Host "   git push origin main" -ForegroundColor Gray
} else {
    Write-Host "   Ainda ha problemas de conexao" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Alternativa: Usar SSH em vez de HTTPS" -ForegroundColor Cyan
    Write-Host "   Execute: git remote set-url origin git@github.com:Abelrodrigo1970/crypto-sinais-automaticos.git" -ForegroundColor Gray
}

Write-Host ""
