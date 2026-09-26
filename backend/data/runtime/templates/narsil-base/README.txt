NARSIL 2026 — Plantilla de perfil Firefox
============================================

Este directorio se copia íntegramente al crear un nuevo perfil de identidad.

Archivos incluidos
------------------
user.js                    Preferencias de Firefox aplicadas al primer arranque.
                           Activa userChrome.css, tema oscuro compacto,
                           telemetría desactivada, sin barra de favoritos,
                           nueva pestaña en blanco.

chrome/userChrome.css      Tema visual con la paleta NARSIL v2.3: lienzo
                           #141B2E, texto #E4DED9, bronce #9F6A57 como filete.
                           OJO: al crear o abrir una identidad, la app reescribe
                           este fichero en el perfil con la regla del badge de
                           identidad, así que el tema del cromo NO se aplica hoy.

chrome/userContent.css     Scrollbars finos en toda la web,
                           about:blank / about:newtab en fondo NARSIL.

Personalización
---------------
- Para cambiar preferencias por defecto, edita user.js.
  Los cambios afectan solo a perfiles creados después de la edición.

- Para ajustar el tema, edita chrome/userChrome.css.
  Las variables --n-* en la cabecera centralizan toda la paleta.

- Para añadir Arkenfox (hardening de privacidad avanzado):
  Descarga https://github.com/arkenfox/user.js/raw/master/user.js
  y fusiona su contenido con el user.js existente.
  Advertencia: Arkenfox activa resistencia a fingerprinting que puede
  romper algunas webs; evalúa cada pref antes de activarla en perfiles
  de operaciones OSINT donde el comportamiento "real de usuario" importa.
