// NARSIL Intel Collector — modules/tiktok.js
// Comportamiento idéntico a TikTracker (NARSIL Shard), adaptado a extensión Firefox MV2.
// Funciones mirrored: generarReporte → _actionProfile
//                     extraerPublicacion → _actionPost
//                     iniciarScrapingMasivo → _actionScrape
//                     findFollowListContainer → _findFollowListContainer
//                     scrollHastaElFinal → _scrollHastaElFinal
//                     extraerDatosUsuario → _extraerDatosUsuario
//                     parseFecha → _parseFecha
// Diferencias respecto a Tampermonkey:
//   • Botones en panel NARSIL en lugar de embebidos en la página.
//   • Descarga via background.js (browser.downloads) en lugar de GM_download.
//   • Sin GM_xmlhttpRequest: la región se extrae del mismo fetch normal.
//   • Sin XLSX.js: export usa NarsilExport.toXLS() → .xls (HTML Excel).
'use strict'

NarsilModules.tiktok = {
  network:    'tiktok',
  collected:  [],    // buffer mínimo para contadores del panel
  _seen:      {},
  _modalOpen:            false, // true cuando #tux-portal-container existe (modal abierto)
  _scraping:             false,
  _cachedProfiles:       {},   // region/language/etc. de SIGI_STATE parseado (más fiable que regex)
  _lastAnnouncedProfile: '',   // último username cuya región se anunció en el panel

  // ── Tipo de página ──────────────────────────────────────────────────────────
  getPageType: function () {
    var p = location.pathname
    if (/^\/@[^/]+\/(video|photo)\/\d+/.test(p)) return 'video'
    if (/^\/@[^/]+\/?$/.test(p))                 return 'profile'
    return 'other'
  },

  // ── Botones del panel (se muestran según contexto, igual que TikTracker) ────
  getActions: function () {
    var type = this.getPageType()
    var a    = []
    if (type === 'profile') {
      a.push({ id: 'profile', label: '⊕ Reporte del perfil (TXT)' })
    } else if (type === 'video') {
      a.push({ id: 'post', label: '⊕ Datos de la publicación (TXT)' })
    }
    if (this._modalOpen) {
      a.push({
        id:    'scrape',
        label: this._scraping ? '⏳ Scraping en curso...' : '⊕ Iniciar scraping → XLSX',
      })
    }
    return a
  },

  runAction: function (id) {
    switch (id) {
      case 'profile': this._actionProfile(); break
      case 'post':    this._actionPost();    break
      case 'scrape':  this._actionScrape();  break
    }
  },

  // ── Panel stats ─────────────────────────────────────────────────────────────
  stats: function () {
    var p = 0
    this.collected.forEach(function (i) { if (i._type === 'profile') p++ })
    return { profiles: p, posts: 0, contacts: 0 }
  },
  getItems: function () { return this.collected },
  clear: function () {
    this.collected = []; this._seen = {}; this._cachedProfiles = {}
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ACCIÓN: Reporte de perfil  (≡ generarReporte en TikTracker)
  // ══════════════════════════════════════════════════════════════════════════════
  _actionProfile: function () {
    var self     = this
    var username = (location.pathname.match(/^\/@([^/?#]+)/) || [])[1]
    if (!username) {
      NarsilPanel && NarsilPanel.log('TikTok: navega a un perfil primero.', 'err')
      return
    }

    NarsilPanel && NarsilPanel.log('TikTok: generando reporte de @' + username + '…')

    // 1. Lectura del DOM (igual que TikTracker)
    var nameEl   = document.querySelector('[data-e2e="user-title"]')
    var bioEl    = document.querySelector('[data-e2e="user-bio"]')
    var linkEl   = document.querySelector('a[data-e2e="user-link"]')
    var avatarEl = document.querySelector('[data-e2e="user-avatar"] img')
                || document.querySelector('[data-e2e="user-avatar"]')
    var followers = '', following = '', likes = ''
    document.querySelectorAll('[data-e2e^="followers-count"],[data-e2e^="following-count"],[data-e2e^="likes-count"]')
      .forEach(function (el) {
        var lbl = el.getAttribute('data-e2e'), val = el.innerText.trim()
        if (lbl.includes('followers')) followers = val
        if (lbl.includes('following')) following = val
        if (lbl.includes('likes'))     likes     = val
      })

    // 2. Dos fetch en paralelo (≡ generarReporte + obtenerRegionMovil de TikTracker)
    //    • fetchHtml:   UA normal, credentials:include  → HTML completo para todos los campos
    //    • fetchRegion: UA móvil vía background webRequest → solo para extraer region
    var profileUrl = 'https://www.tiktok.com/@' + username

    var fetchHtml = fetch(profileUrl, { credentials: 'include' })
      .then(function (r) { return r.text() })
      .catch(function () { return '' })

    // X-Narsil-Mobile:1 activa el listener de background.js que sustituye el User-Agent
    // por el UA móvil de TikTracker antes de que el request llegue a TikTok.
    var fetchRegion = fetch(profileUrl, {
      credentials: 'omit',
      headers: { 'X-Narsil-Mobile': '1' },
    }).then(function (r) { return r.text() })
      .then(function (html) {
        var base   = html.indexOf('"uniqueId":"' + username + '"')
        var bloque = html.slice(Math.max(0, base - 4000))
        var m      = bloque.match(/"region":"(.*?)"/)
        return m ? m[1] : ''
      })
      .catch(function () { return '' })

    Promise.all([fetchHtml, fetchRegion]).then(function (results) {
        var html         = results[0]
        var mobileRegion = results[1]

        var baseIdx = html.indexOf('"uniqueId":"' + username + '"')
        var bloque  = html.slice(Math.max(0, baseIdx - 4000))
        var get     = function (rx) { return (bloque.match(rx) || [])[1] || '' }

        // Emails: bio del DOM primero, luego HTML completo; filtrar dominios de plataforma
        var BLOCKED = /^(tiktok\.com|bytedance\.com|tiktokcdn\.com|musical\.ly|sentry\.io|example\.com|ejemplo\.com|correo\.com|test\.com)$/i
        var bioText   = (bioEl && bioEl.innerText) ? bioEl.innerText : ''
        var rawEmails = (bioText + ' ' + html).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
        var emails    = [...new Set(rawEmails.filter(function (e) {
          return !BLOCKED.test((e.split('@')[1] || '').toLowerCase())
        }))]

        // Región: UA móvil (más fiable, como TikTracker) → caché SIGI_STATE → regex HTML
        var cached   = self._cachedProfiles[username] || {}
        var region   = mobileRegion || cached.region  || get(/"region":"(.*?)"/) || ''
        var language = cached.language || get(/"language":"(.*?)"/)               || ''
        var verified = cached.verified || get(/"verified":(true|false)/)          || ''
        var uid      = cached.id       || (html.match(/"id":"(\d{6,})"/) || [])[1] || ''
        var created  = cached.created  || get(/"createTime":(\d{10})/)            || ''
        var nickMod  = cached.nickMod  || get(/"nickNameModifyTime":(\d{10})/)    || ''

        // 3. Construir el TXT (mismo formato que TikTracker)
        var data = ['👤 Nombre de usuario: @' + username]
        if (nameEl && nameEl.innerText)  data.push('📛 Nombre real: '          + nameEl.innerText.trim())
        if (bioEl  && bioEl.innerText)   data.push('📝 Bio: '                  + bioEl.innerText.trim())
        if (linkEl && linkEl.href)       data.push('🔗 Enlace externo: '        + linkEl.href)
        if (avatarEl && avatarEl.src)    data.push('🖼️ Imagen de perfil: '      + avatarEl.src)
        if (followers)                   data.push('👥 Seguidores: '            + followers)
        if (following)                   data.push('➡️ Siguiendo: '             + following)
        if (likes)                       data.push('❤️ Me gusta: '              + likes)
        if (emails.length)               data.push('📧 Correos: '               + emails.join(', '))
        if (region)                      data.push('📍 Región del perfil: '     + region)
        if (language)                    data.push('🗣️ Idioma del perfil: '     + language)
        if (verified)                    data.push('✔️ Verificado: '            + verified)
        if (uid)                         data.push('🆔 ID interno TikTok: '     + uid)
        if (created)                     data.push('📅 Fecha de creación: '     + self._parseFecha(created))
        if (nickMod)                     data.push('🔄 Cambio de nick: '        + self._parseFecha(nickMod))

        self._sendDownload(username + '_tiktok_profile.txt', data.join('\n'), 'text/plain;charset=utf-8')
        NarsilPanel && NarsilPanel.log('TikTok: reporte de @' + username + ' descargado.', 'ok')
      })
      .catch(function (e) {
        NarsilPanel && NarsilPanel.log('TikTok: error al generar reporte — ' + e.message, 'err')
      })
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ACCIÓN: Datos de publicación  (≡ extraerPublicacion en TikTracker)
  // ══════════════════════════════════════════════════════════════════════════════
  _actionPost: function () {
    var self     = this
    var url      = location.href
    var pm       = url.match(/\/(video|photo)\/(\d+)/)
    var username = (url.split('/@')[1] || '').split('/')[0]
    var videoId  = pm ? pm[2] : ''

    if (!videoId) {
      NarsilPanel && NarsilPanel.log('TikTok: navega a una publicación primero.', 'err')
      return
    }

    NarsilPanel && NarsilPanel.log('TikTok: extrayendo publicación ' + videoId + '…')

    // 1. DOM (igual que TikTracker)
    var data = []
    data.push('📹 Publicación ID: ' + videoId)
    data.push('👤 Usuario: @' + username)
    data.push('🔗 URL: ' + url)

    var descEl  = document.querySelector('[data-e2e="browse-video-desc"]')
    var musicEl = document.querySelector('[data-e2e="browse-music-info"]')
    if (descEl  && descEl.innerText)  data.push('📝 Descripción: ' + descEl.innerText.trim())
    if (musicEl && musicEl.innerText) data.push('🎵 Música: '      + musicEl.innerText.trim())

    document.querySelectorAll('[data-e2e="like-count"],[data-e2e="comment-count"],[data-e2e="share-count"]')
      .forEach(function (el) {
        var lbl = el.getAttribute('data-e2e'), val = el.innerText.trim()
        if (lbl.includes('like'))    data.push('❤️ Me gusta: '    + val)
        if (lbl.includes('comment')) data.push('💬 Comentarios: ' + val)
        if (lbl.includes('share'))   data.push('🔁 Compartidos: ' + val)
      })

    // Fecha visible — mismo procesamiento que TikTracker
    var dateEl = document.querySelector('[data-e2e="browser-nickname"] span:last-child')
    if (dateEl && dateEl.innerText) {
      var raw    = dateEl.innerText.trim()
      var partes = raw.split('-')
      var fecha  = raw
      if (partes.length === 2) {
        fecha = partes[1].padStart(2, '0') + '-' + partes[0].padStart(2, '0') + '-' + new Date().getFullYear()
      } else if (partes.length === 3) {
        fecha = partes[2].padStart(2, '0') + '-' + partes[1].padStart(2, '0') + '-' + partes[0]
      }
      data.push('📆 Fecha de publicación: ' + fecha)
    }

    // 2. Fetch de la URL para locationCreated (igual que TikTracker)
    fetch(url, { credentials: 'include' })
      .then(function (r) { return r.text() })
      .then(function (html) {
        var bloque    = html.slice(Math.max(0, html.indexOf(videoId) - 4000))
        var ubicacion = (bloque.match(/locationCreated":"([^"]*)/) || [])[1] || ''
        if (ubicacion) data.push('📍 Ubicación de la publicación: ' + ubicacion)

        // 3. Comentarios (mismo endpoint que TikTracker)
        return fetch(
          'https://www.tiktok.com/api/comment/list/?aid=1988&count=20&cursor=0&aweme_id=' + videoId,
          { headers: { accept: 'application/json' }, credentials: 'include' }
        ).then(function (r) { return r.json() })
          .then(function (json) {
            if (json && json.comments && json.comments.length) {
              data.push('\n🗣️ Comentarios destacados:')
              json.comments.forEach(function (c) {
                var u = (c.user && (c.user.nickname || c.user.uniqueId)) || 'usuario_desconocido'
                data.push('- @' + u + ': ' + (c.text || ''))
              })
            } else {
              data.push('\n🗣️ No se pudieron recuperar comentarios.')
            }
          })
          .catch(function () { data.push('\n🗣️ No se pudieron recuperar comentarios.') })
      })
      .then(function () {
        self._sendDownload(videoId + '_post.txt', data.join('\n'), 'text/plain;charset=utf-8')
        NarsilPanel && NarsilPanel.log('TikTok: publicación ' + videoId + ' descargada.', 'ok')
      })
      .catch(function (e) {
        NarsilPanel && NarsilPanel.log('TikTok: error al extraer publicación — ' + e.message, 'err')
      })
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ACCIÓN: Scraping masivo de seguidores/seguidos  (≡ iniciarScrapingMasivo)
  // ══════════════════════════════════════════════════════════════════════════════
  _actionScrape: function () {
    var self = this
    if (this._scraping) return

    var contenedor = this._findFollowListContainer()
    if (!contenedor) {
      NarsilPanel && NarsilPanel.log('TikTok: no se encontró el modal. Ábrelo y vuelve a pulsar.', 'err')
      return
    }

    this._scraping = true
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    NarsilPanel && NarsilPanel.log('TikTok: scraping iniciado, desplazando lista…')

    var resultados = []

    this._scrollHastaElFinal(contenedor).then(function () {
      // Extraer usernames únicos de los enlaces (igual que TikTracker)
      var seen     = {}, usuarios = []
      contenedor.querySelectorAll('a[href^="/@"]').forEach(function (a) {
        var u = (a.href.split('/@')[1] || '').split('?')[0].split('/')[0]
        if (u && !seen[u]) { seen[u] = true; usuarios.push(u) }
      })

      if (!usuarios.length) {
        NarsilPanel && NarsilPanel.log('TikTok: no se encontraron usuarios en el modal.', 'err')
        self._scraping = false
        NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
        return
      }

      NarsilPanel && NarsilPanel.log('TikTok: ' + usuarios.length + ' usuarios encontrados. Extrayendo datos…')

      var idx = 0
      function next() {
        if (idx >= usuarios.length) {
          if (!resultados.length) {
            NarsilPanel && NarsilPanel.log('TikTok: no se obtuvieron datos de usuarios.', 'err')
            self._scraping = false
            NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
            return
          }
          // Descargar como XLSX real (Excel lo abre sin avisos de formato)
          var ts    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          var bytes = NarsilExport.toXLSX(resultados)
          var b64   = NarsilExport.uint8ToBase64(bytes)
          self._sendDownloadBinary(
            'tiktok_scrape_' + ts + '.xlsx',
            b64,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          )
          NarsilPanel && NarsilPanel.log(
            'TikTok: ' + resultados.length + ' usuarios exportados.', 'ok')
          self._scraping = false
          NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
          return
        }

        var user = usuarios[idx++]
        NarsilPanel && NarsilPanel.log(
          'TikTok: extrayendo @' + user + ' (' + idx + '/' + usuarios.length + ')…')

        self._extraerDatosUsuario(user).then(function (fila) {
          if (fila) resultados.push(fila)
          setTimeout(next, 2000) // mismo delay que TikTracker
        }).catch(function () { setTimeout(next, 2000) })
      }

      next()
    })
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // HELPERS (mirror exacto de TikTracker)
  // ══════════════════════════════════════════════════════════════════════════════

  // ≡ findFollowListContainer
  _findFollowListContainer: function () {
    var portal = document.querySelector('#tux-portal-container')
    if (!portal) return null

    var box = portal.querySelector('[class*="DivUserListContainer"]')
    if (box) return box

    var candidates = Array.from(portal.querySelectorAll('div,section,ul'))
      .filter(function (n) { return n.querySelector('a[href^="/@"]') })
    if (!candidates.length) return null
    candidates.sort(function (a, b) {
      return b.querySelectorAll('a[href^="/@"]').length - a.querySelectorAll('a[href^="/@"]').length
    })
    return candidates[0] || null
  },

  // ≡ scrollHastaElFinal
  _scrollHastaElFinal: function (contenedor) {
    return new Promise(function (resolve) {
      var previousCount = 0, attempts = 0
      function step() {
        contenedor.scrollBy(0, Math.max(800, contenedor.clientHeight))
        window.scrollBy(0, 400)
        setTimeout(function () {
          var actualCount = contenedor.querySelectorAll('a[href^="/@"]').length
          if (actualCount === previousCount) { attempts++ } else { attempts = 0; previousCount = actualCount }
          if (attempts < 10) { step() } else { resolve() }
        }, 1500)
      }
      step()
    })
  },

  // ≡ extraerDatosUsuario — devuelve objeto {clave: valor} para NarsilExport.toXLS
  // Dos fetch en paralelo (≡ obtenerRegionMovil + bloque normal de TikTracker):
  //   • UA normal con cookies → todos los campos del HTML embebido
  //   • UA móvil vía X-Narsil-Mobile → región real (TikTok solo la devuelve con UA móvil)
  _extraerDatosUsuario: function (user) {
    var url = 'https://www.tiktok.com/@' + user

    var fetchHtml = fetch(url, { credentials: 'include' })
      .then(function (r) { return r.text() })
      .catch(function () { return '' })

    var fetchRegion = fetch(url, {
      credentials: 'omit',
      headers: { 'X-Narsil-Mobile': '1' },
    }).then(function (r) { return r.text() })
      .then(function (html) {
        var base   = html.indexOf('"uniqueId":"' + user + '"')
        var bloque = html.slice(Math.max(0, base - 4000))
        var m      = bloque.match(/"region":"(.*?)"/)
        return m ? m[1] : ''
      })
      .catch(function () { return '' })

    return Promise.all([fetchHtml, fetchRegion]).then(function (results) {
      var html         = results[0]
      var mobileRegion = results[1]
      if (!html) return null

      var baseIdx = html.indexOf('"uniqueId":"' + user + '"')
      var bloque  = html.slice(Math.max(0, baseIdx - 4000))
      var get     = function (rx) { return (bloque.match(rx) || [])[1] || '' }
      var id      = (html.match(/"id":"(\d{6,})"/) || [])[1] || ''
      if (!id || !user) return null
      // Campos vacíos se marcan en rojo cursiva en el XLSX vía NarsilExport.missing()
      var nickname = get(/"nickname":"(.*?)"/)
      var region   = mobileRegion || get(/"region":"(.*?)"/)
      var language = get(/"language":"(.*?)"/)
      var created  = get(/"createTime":(\d+)/)
      var nickMod  = get(/"nickNameModifyTime":(\d+)/)
      return {
        'ID':               id,
        'Nickname':         nickname || NarsilExport.missing(),
        'Username':         user,
        'Perfil URL':       'https://www.tiktok.com/@' + user,
        'Region':           region   || NarsilExport.missing(),
        'Language':         language || NarsilExport.missing(),
        'Create Time':      created  ? NarsilModules.tiktok._parseFecha(created) : NarsilExport.missing(),
        'Nick Modify Time': nickMod  ? NarsilModules.tiktok._parseFecha(nickMod) : NarsilExport.missing(),
      }
    }).catch(function () { return null })
  },

  // ── Anuncio de región al cambiar de perfil (≡ alert al cargar perfil de TikTracker)
  _announceRegion: function () {
    var username = (location.pathname.match(/^\/@([^/?#]+)\/?$/) || [])[1]
    if (!username || username === this._lastAnnouncedProfile) return
    this._lastAnnouncedProfile = username

    fetch('https://www.tiktok.com/@' + username, {
      credentials: 'omit',
      headers: { 'X-Narsil-Mobile': '1' },
    }).then(function (r) { return r.text() })
      .then(function (html) {
        var base   = html.indexOf('"uniqueId":"' + username + '"')
        var bloque = html.slice(Math.max(0, base - 4000))
        var m      = bloque.match(/"region":"(.*?)"/)
        var region = m ? m[1] : ''
        if (region) {
          NarsilPanel && NarsilPanel.log('🌍 @' + username + ' — región detectada: ' + region, 'ok')
        }
      })
      .catch(function () {})
  },

  // ≡ parseFecha
  _parseFecha: function (ts) {
    if (!ts) return ''
    var d = new Date(Number(ts) * 1000)
    var z = function (n) { return String(n).padStart(2, '0') }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
         + ' ' + z(d.getHours()) + ':' + z(d.getMinutes())
  },

  // ── Descarga via background.js — no requiere activación de usuario ──────────
  _sendDownload: function (filename, content, mimeType) {
    var safe = (filename || 'narsil').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200)
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .catch(function () {})
  },
  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = (filename || 'narsil').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200)
    browser.runtime.sendMessage({
      type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType,
    }).catch(function () {})
  },

  // ── Buffer mínimo para contadores del panel ─────────────────────────────────
  _add: function (item) {
    var key = item._type + ':' + item.username
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
  },

  // Captura pasiva: contador del panel + caché de campos de perfil para _actionProfile
  onPageData: function (key, data) {
    try {
      var self = this, users = {}
      if (key === 'SIGI_STATE') {
        users = ((data.UserModule || {}).users) || {}
      } else if (key === '__NEXT_DATA__') {
        var ui = (((data.props || {}).pageProps) || {}).userInfo
        if (ui && ui.user && ui.user.uniqueId) users[ui.user.uniqueId] = ui.user
      } else if (key === '__UNIVERSAL_DATA__') {
        var ud = data['webapp.user-detail']
        if (ud && ud.userInfo && ud.userInfo.user && ud.userInfo.user.uniqueId) {
          users[ud.userInfo.user.uniqueId] = ud.userInfo.user
        }
      }
      Object.keys(users).forEach(function (k) {
        var u = users[k]
        if (!u || !u.uniqueId) return
        self._add({ _type: 'profile', username: u.uniqueId })
        // Cachear campos que el fetch-regex a veces no encuentra (region es el más problemático)
        self._cachedProfiles[u.uniqueId] = {
          region:   u.region          || '',
          language: u.language        || '',
          verified: u.verified != null ? String(u.verified) : '',
          id:       u.id              || '',
          created:  u.createTime      ? String(u.createTime)         : '',
          nickMod:  u.nickNameModifyTime ? String(u.nickNameModifyTime) : '',
        }
      })
    } catch (_) {}
  },

  onNetworkRequest: function (url, body) {
    try {
      if (/user\/detail/i.test(url) && body && body.userInfo && body.userInfo.user) {
        var u = body.userInfo.user
        if (!u.uniqueId) return
        this._add({ _type: 'profile', username: u.uniqueId })
        this._cachedProfiles[u.uniqueId] = {
          region:   u.region          || '',
          language: u.language        || '',
          verified: u.verified != null ? String(u.verified) : '',
          id:       u.id              || '',
          created:  u.createTime      ? String(u.createTime)         : '',
          nickMod:  u.nickNameModifyTime ? String(u.nickNameModifyTime) : '',
        }
      }
    } catch (_) {}
  },

  // ── Observer del modal + watcher de URL para anunciar región al navegar ─────
  _initObserver: function () {
    var self    = this
    var pending = null
    var observer = new MutationObserver(function () {
      clearTimeout(pending)
      pending = setTimeout(function () {
        var wasOpen     = self._modalOpen
        self._modalOpen = !!self._findFollowListContainer()
        if (self._modalOpen !== wasOpen) {
          if (!self._modalOpen) self._scraping = false
          NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
        }
      }, 200)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // Watcher de URL: anuncia la región cada vez que el usuario aterrice en un perfil.
    var lastUrl = ''
    setInterval(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        self._announceRegion()
      }
    }, 600)
  },
}

// Auto-inicializar el observer (document_idle → body ya existe)
if (NarsilDetector.current() === 'tiktok') {
  NarsilModules.tiktok._initObserver()
}
