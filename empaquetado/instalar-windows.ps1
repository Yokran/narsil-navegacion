# Instala (o actualiza) «NARSIL Navegacion.exe» en la carpeta del operador y deja un acceso
# directo en el escritorio. Conserva lo que es del operador: navegador base, identidades y
# ajustes. Si la carpeta venía de la instalación anterior (con backend\data), la reordena.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File empaquetado\instalar-windows.ps1
#   (toma dist\NARSIL Navegacion-windows-<arquitectura>.exe; -Exe para indicar otro fichero)
# En la carpeta del operador el programa se llama siempre "NARSIL Navegacion.exe".
#
param(
    [string]$Exe = "",
    [string]$Destino = "$env:USERPROFILE\narsil-navegacion"
)
$ErrorActionPreference = "Stop"
# Las rutas relativas se resuelven desde la raíz del repositorio, se lance desde donde se lance.
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
if ($Exe -eq "") {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x86_64" }
    $Exe = "dist\NARSIL Navegacion-windows-$arch.exe"
}
$exe = Resolve-Path $Exe

# Si hay una instancia en marcha, se para por el PID del puerto: nunca por nombre de proceso.
$viva = Get-NetTCPConnection -LocalPort 8420 -State Listen -ErrorAction SilentlyContinue
if ($viva) { Stop-Process -Id $viva.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }

New-Item -ItemType Directory -Force -Path $Destino | Out-Null

# Instalación anterior (código fuente + backend\data): los datos pasan a data\ junto al exe.
if ((Test-Path "$Destino\backend\data") -and -not (Test-Path "$Destino\data")) {
    Move-Item "$Destino\backend\data" "$Destino\data"
    Write-Host "Datos del operador movidos a $Destino\data"
}
$anterior = "$Destino\_anterior-" + (Get-Date -Format yyyyMMdd-HHmmss)
$restos = @("backend", "ui", "docs", "arrancar.bat", "arrancar.ps1", "arrancar.sh", "README.md", ".gitignore")
$movidos = @()
foreach ($r in $restos) {
    if (Test-Path "$Destino\$r") {
        New-Item -ItemType Directory -Force -Path $anterior | Out-Null
        Move-Item "$Destino\$r" "$anterior\$r"
        $movidos += $r
    }
}
if ($movidos.Count -gt 0) { Write-Host ("Instalación anterior apartada en " + $anterior + ": " + ($movidos -join ", ")) }

Copy-Item $exe "$Destino\NARSIL Navegacion.exe" -Force
New-Item -ItemType Directory -Force -Path "$Destino\data" | Out-Null

# Acceso directo en el escritorio, con el icono del propio ejecutable.
$escritorio = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
$atajo = $ws.CreateShortcut("$escritorio\NARSIL Navegacion.lnk")
$atajo.TargetPath = "$Destino\NARSIL Navegacion.exe"
$atajo.WorkingDirectory = $Destino
$atajo.IconLocation = "$Destino\NARSIL Navegacion.exe,0"
$atajo.Description = "NARSIL Navegacion - identidades de navegacion"
$atajo.Save()

Write-Host ("INSTALADO " + $Destino + "\NARSIL Navegacion.exe")
Write-Host ("Navegador base: " + (Test-Path "$Destino\data\runtime\base_browser\firefox.exe"))
Write-Host ("Acceso directo: " + "$escritorio\NARSIL Navegacion.lnk")
