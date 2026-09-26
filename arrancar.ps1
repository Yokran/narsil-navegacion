# NARSIL - Navegacion :: arranque en Windows
#
# IMPORTANTE: esto se ejecuta en TU escritorio, no por SSH. Los navegadores de las identidades
# se abren en la sesion que lanza este script; si se lanza desde una sesion remota no
# interactiva, las ventanas existen pero no las ve nadie.

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $raiz "backend"
$venv = Join-Path $backend ".venv"
$py = Join-Path $venv "Scripts\python.exe"

Write-Host ""
Write-Host "  N.A.R.S.I.L. - Navegacion" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "  No encuentro Python en el PATH. Instala Python 3.11 o superior." -ForegroundColor Red
    Read-Host "  Pulsa Enter para salir"
    exit 1
}

if (-not (Test-Path $py)) {
    Write-Host "  Primera vez: preparando el entorno (tarda un minuto)..." -ForegroundColor Yellow
    python -m venv $venv
    & $py -m pip install --upgrade pip --quiet
    & $py -m pip install -r (Join-Path $backend "requirements.txt") --quiet
    # Ventana propia (WebView2 de Edge, que viene con Windows 10/11).
    & $py -m pip install pywebview pythonnet --quiet
    Write-Host "  Entorno listo." -ForegroundColor Green
}

if (-not (Test-Path (Join-Path $raiz "ui\dist\index.html"))) {
    Write-Host "  AVISO: la interfaz no esta compilada (ui\dist). La API responde, la pantalla no." -ForegroundColor Yellow
}

Write-Host "  Arrancando NARSIL Navegacion (ventana propia si hay pywebview; si no, el navegador)."
Write-Host "  Para parar: cierra la ventana o Ctrl+C en esta ventana."
Write-Host ""

Set-Location $backend
& $py narsil_navegacion.py
