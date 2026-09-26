# Construir los ejecutables

El código es uno y la versión es una. Lo que cambia por sistema es el fichero que se
distribuye, y cada uno se construye **en su propia plataforma** (PyInstaller no cruza
sistemas): un Windows x64 produce el `.exe` x64, un Linux ARM64 produce el binario ARM64.

| Sistema / arquitectura | Fichero resultante | Script |
|---|---|---|
| Windows x86-64 | `dist\NARSIL Navegacion-windows-x86_64.exe` | `empaquetado\construir.ps1` |
| Windows ARM64 | `dist\NARSIL Navegacion-windows-arm64.exe` | `empaquetado\construir.ps1` |
| Linux x86-64 | `dist/narsil-navegacion-linux-x86_64` | `empaquetado/construir.sh` |
| Linux ARM64 | `dist/narsil-navegacion-linux-aarch64` | `empaquetado/construir.sh` |

## Requisitos de la máquina de construcción

- **Python 3.11 o superior** en el PATH.
- **La interfaz compilada** en `ui/dist`. Si el repositorio viene sin ella: Node 20+ y
  `cd ui && npm install && npm run build`.
- **Windows**: nada más. El motor de ventana es WebView2, que viene con Edge.
- **Linux**: para la ventana propia, WebKitGTK del sistema. En Debian/Ubuntu:
  `sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1`. Sin él, el ejecutable se
  construye igual y abre la interfaz en el navegador del sistema.

Los scripts crean su propio entorno virtual (`.venv-build`), instalan lo que necesitan
(`backend/requirements.txt` + `empaquetado/requirements-build.txt`) y dejan el resultado en
`dist/`. Ese entorno se conserva entre construcciones.

## Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File empaquetado\construir.ps1
```

Termina con `CONSTRUIDO dist\NARSIL Navegacion-windows-<arquitectura>.exe`. Para instalarlo en
el equipo actual (carpeta del usuario + acceso directo en el escritorio):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File empaquetado\instalar-windows.ps1
```

## Linux

```bash
bash empaquetado/construir.sh
bash empaquetado/instalar-linux.sh     # opcional: ~/.local/share + entrada de menú con el escudo
```

## Qué lleva dentro el ejecutable y qué no

**Dentro**: Python, el servidor local, la interfaz compilada, la extensión Collector, la
plantilla base de perfil y el icono. Todo lo que es de la app.

**Fuera**, en la carpeta `data/` que se crea junto al ejecutable: el navegador Firefox ESR (se
descarga desde la propia app la primera vez, ~70 MB desde mozilla.org o el canal ESR de
Canonical en Linux ARM64), las identidades, los ajustes y el registro. Todo lo que es del
usuario. Si la carpeta del ejecutable no se puede escribir (un pendrive protegido, `Program
Files`), `data/` va al perfil del usuario: `%LOCALAPPDATA%\NARSIL Navegacion\data` en Windows,
`~/.local/share/NARSIL Navegacion/data` en Linux. La variable `NAV_DATA_DIR` la fija a mano.

En cada arranque, el ejecutable vuelca su extensión y su plantilla en `data/runtime/`: una
versión nueva trabaja siempre con su propio runtime, y las identidades ya creadas refrescan la
extensión al abrirse.

## Comprobar sin escritorio

`NARSIL Navegacion.exe --sin-ventana` (o `./narsil-navegacion --sin-ventana`) arranca sólo el
servidor local en `http://127.0.0.1:8420`; se para con Ctrl+C. Sirve para verificar una
instalación por consola o por SSH, donde no hay dónde abrir una ventana:

```
curl http://127.0.0.1:8420/api/status
curl http://127.0.0.1:8420/api/browser/check
```

## Publicar una versión

1. Actualizar `VERSION` en `backend/app/api/system.py` y etiquetar el commit (`git tag v1.0`).
2. Construir los cuatro ficheros, cada uno en su plataforma, con el mismo commit.
3. Publicarlos como *Release* en GitHub con la etiqueta, o copiarlos a `ejecutables/` en una
   copia portátil del repositorio.

Las pruebas (`cd backend && python -m pytest`) no abren Firefox ni salen a la red; las que
necesitan un navegador real van marcadas `navegador` y se activan a mano.
