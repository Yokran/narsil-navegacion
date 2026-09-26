# Construye el ejecutable unico de NARSIL Navegacion en Windows, con el escudo como icono:
#   dist\NARSIL Navegacion-windows-x86_64.exe   (en un Windows x64)
#   dist\NARSIL Navegacion-windows-arm64.exe    (en un Windows ARM64)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File empaquetado\construir.ps1
#
# Requiere Python 3.11+ en el PATH y la interfaz compilada en ui\dist (si no viene compilada:
# `cd ui; npm install; npm run build`). El navegador base NO va dentro
# del ejecutable: se instala desde la app o se copia en data\runtime\base_browser.
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

if (-not (Test-Path "ui\dist\index.html")) {
    throw "Falta ui\dist\index.html: compila la interfaz (cd ui; npm run build) o usa el paquete que la trae."
}

$venv = ".venv-build"
if (-not (Test-Path "$venv\Scripts\python.exe")) { python -m venv $venv }
$py = "$venv\Scripts\python.exe"
& $py -m pip install --disable-pip-version-check --quiet --upgrade pip
& $py -m pip install --disable-pip-version-check --quiet -r backend\requirements.txt -r empaquetado\requirements-build.txt

# Un artefacto por sistema y arquitectura: el nombre lo dice y no se confunden en la descarga.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x86_64" }
$nombre = "NARSIL Navegacion-windows-$arch"

if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
if (Test-Path "build") { Remove-Item -Recurse -Force "build" }

& $py -m PyInstaller --noconfirm --clean --onefile --windowed `
    --name $nombre `
    --icon "$raiz\empaquetado\narsil.ico" `
    --distpath "dist" --workpath "build" --specpath "build" `
    --paths "$raiz\backend" `
    --add-data "$raiz\ui\dist;ui" `
    --add-data "$raiz\backend\data\runtime\extensions;runtime\extensions" `
    --add-data "$raiz\backend\data\runtime\templates;runtime\templates" `
    --add-data "$raiz\empaquetado\narsil.ico;." `
    --collect-submodules app `
    --collect-all webview `
    --collect-all clr_loader `
    --collect-all pythonnet `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    "$raiz\backend\narsil_navegacion.py"

$exe = Get-Item "dist\$nombre.exe"
Write-Host ("CONSTRUIDO " + $exe.FullName + " (" + [math]::Round($exe.Length / 1MB, 1) + " MB)")
