# Ejecutables

Aquí van los ficheros que se distribuyen a los usuarios, uno por sistema y arquitectura:

| Fichero | Para |
|---|---|
| `NARSIL Navegacion-windows-x86_64.exe` | Windows 10/11 de 64 bits (la inmensa mayoría) |
| `NARSIL Navegacion-windows-arm64.exe` | Windows en ARM (Surface, portátiles Snapdragon) |
| `narsil-navegacion-linux-x86_64` | Linux de 64 bits (Ubuntu, Debian, Fedora…) |
| `narsil-navegacion-linux-aarch64` | Linux en ARM64 |

Los binarios **no se guardan en git**: pesan entre 20 y 150 MB y se generan a partir del código
con `empaquetado/construir.ps1` (Windows) o `empaquetado/construir.sh` (Linux), cada uno en su
propia plataforma. En GitHub se publican como *Releases*; en una copia portátil (pendrive) se
dejan en esta carpeta junto al resto del repositorio.
