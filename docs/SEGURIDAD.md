# Seguridad y privacidad

Esta app existe para que las identidades de navegación de un investigador no se parezcan entre
sí ni a él. Eso obliga a ser muy claros sobre qué hace en la red y qué hace en el equipo.

## Qué sale del equipo, y qué no

- **La app no llama a casa.** No hay telemetría, ni estadísticas de uso, ni comprobación
  automática de versiones. Lo único que sale del equipo por iniciativa de la app, y siempre
  porque el operador pulsa un botón, es: la descarga de Firefox ESR (*Instalar Firefox ESR*:
  mozilla.org, o el canal ESR de Canonical en Linux ARM64), la sonda a la S.A.R.A. configurada
  (*Configurar S.A.R.A.*) y la consulta a la API de GitHub de este repositorio (*Buscar
  actualizaciones*). Una actualización solo se instala si el SHA-256 del ejecutable descargado
  coincide con el publicado en `SHA256SUMS` de la misma versión; si no, se borra y no se
  ejecuta nada.
- **Ninguna identidad habla con terceros por culpa de la app.** La página de inicio de cada
  identidad, la extensión Collector y la plantilla base no piden nada fuera de `127.0.0.1`:
  ni tipografías, ni iconos, ni scripts. Una prueba automática (`test_runtime_sin_cdn.py`)
  vigila que siga siendo así.
- **Cada identidad sale por la red del equipo** (su VPN, su IP). La app no enruta el tráfico
  de las identidades por ningún servidor.
- **S.A.R.A. se abre como uno mismo**, nunca dentro de una identidad: la plataforma se consulta
  con la sesión del analista, no con la de la identidad que está investigando.

## El servidor local

La app corre un servidor en `127.0.0.1:8420` que sirve la interfaz y la API de identidades.
Escucha **sólo en la interfaz de bucle local** (no es configurable) y lleva un guardia
propio, porque el navegador de cada identidad abre contenido hostil por oficio y una página
abierta en una identidad puede intentar hablar con ese puerto:

- Se atienden únicamente peticiones cuya cabecera `Host` sea local (contra *DNS rebinding*).
- Las operaciones que cambian algo exigen un `Origin`/`Referer` local (contra *CSRF*).
- Las peticiones marcadas por el navegador como de otro sitio (`Sec-Fetch-Site: cross-site`)
  se rechazan, salvo la navegación de sólo lectura que necesita la nueva pestaña de cada
  identidad.
- La interfaz se sirve con una política de contenido cerrada (todo del propio origen), y la
  API con `Cache-Control: no-store`.
- El servidor sólo sirve lo que hay dentro de la interfaz compilada: las rutas se resuelven y
  se comprueba que no salgan de ahí.

**No exponga este puerto a ninguna red.** Quien lo alcance controla todas las identidades.

## En el equipo

- Los nombres de identidad y de plantilla se validan antes de tocar el disco (nada de `..`,
  separadores ni caracteres de control), y los avatares se limitan a imágenes de tamaño acotado.
- Las carpetas de identidades, ajustes y registro se crean con permisos privados en Linux.
- La dirección de S.A.R.A. sólo admite `http://` o `https://`; lo que se abre en el navegador del
  sistema es siempre esa URL guardada o el enlace de acceso fijo, nunca algo que mande una página.
- Firefox se lanza con su perfil y su página de inicio; los argumentos no admiten opciones de
  línea de comandos ni esquemas distintos de `http`/`https`.

## Las identidades y el disco

Lo valioso de esta app son las identidades: las cookies y sesiones de cada perfil, que son
carpetas normales dentro de `data/profiles`. **Están tan protegidas como el disco en el que
viven, ni más ni menos.** La app no les pone contraseña a propósito, y conviene saber por qué:

- Un PIN o una contraseña de la app que sólo cerrara la ventana no protegería nada: quien tenga
  el equipo copia la carpeta del perfil y la abre en cualquier Firefox. Sería aparentar una
  seguridad que no existe, que es peor que no tenerla.
- Un PIN que cifrara los perfiles tampoco llega: contra un fichero copiado a otra máquina se
  prueban todas las combinaciones sin límite de intentos, y Firefox necesita el perfil en claro
  mientras está abierto.

Lo que sí protege las identidades es lo que ya pone el sistema, y es responsabilidad del puesto:

- **Cifrado de disco** (BitLocker en Windows, LUKS en Linux) contra el equipo perdido o
  incautado. Sin él, no hay protección que valga para lo que hay en `data/`.
- **Bloqueo de sesión** contra el equipo desatendido. La app corre con el usuario del sistema
  operativo y sus carpetas nacen privadas (0700 en Linux), pero **el servidor local no pide
  credenciales**: cualquier programa o cuenta de la misma máquina que alcance `127.0.0.1:8420`
  mientras la app está abierta puede operar las identidades. Es una decisión de diseño para un
  puesto de un solo operador; en un equipo compartido, cierre la app cuando no la use.

Si su organización exige que las identidades queden inservibles fuera del puesto aunque el disco
no esté cifrado, la vía es atarlas al almacén de claves del sistema (DPAPI o Windows Hello,
el llavero en Linux), no un PIN. No está implementado; si lo necesita, dígalo por el contacto de
abajo.

## Firefox ESR, y por qué ESR

Un Firefox *release* ignora la preferencia que permite cargar la extensión Collector sin
firma: acepta el perfil, arranca sin una queja y deja la extensión fuera. La app comprueba el
canal del navegador y se niega a abrir identidades si no es ESR, diciéndolo en pantalla. Firefox
se descarga de Mozilla y no se modifica; conserva su licencia (MPL 2.0).

## Si encuentra un problema de seguridad

Escriba al titular por el contacto de [narsilintelligence.com](https://narsilintelligence.com)
antes de hacerlo público. Se agradece.
