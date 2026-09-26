// NARSIL Intel Collector — modules/facebook.js
// Comportamiento basado en "Some Helper Tools Sirius" (NSK OSINT, marzo 2026)
// adaptado a extensión Firefox MV2.
//
// Estrategia:
//   • _getEntity()           ≡ TM_getId          → re-fetch del HTML actual + extrae
//                                                   userID/groupID/pageID + fb_dtsg token.
//   • _actionProfile()       ≡ TM_getFbUserData  → POST GraphQL CometHovercardQueryRendererQuery
//                                                   para obtener nombre, ID, URL, JOIN DATE, foto
//                                                   + extracción del DOM para Intro/About.
//   • _actionFriends()       ≡ TM_storeFBfriends → navega al tab de amigos, auto-scroll,
//                                                   extrae anchors hacia perfiles, exporta XLSX.
//   • _announceProfile()     → al cambiar a un perfil, lee userID del DOM y lo registra
//                              en el panel (≡ TM_showId pero sin clipboard).
//
// Diferencias respecto a Tampermonkey/Sirius:
//   • Botones en panel NARSIL en lugar de menú flotante.
//   • Descarga via background.js (browser.downloads) en lugar de blob+anchor.
//   • Sin acceso a React fibers (el plan de Sirius requiere React DevTools);
//     usamos scraping del DOM como fuente para la lista de amigos. Los datos
//     individuales por amigo se enriquecen vía fetch a su perfil (ciudad/origen).
//   • XLSX nativo via NarsilExport.toXLSX (sin XLSX.js externo).
'use strict'

NarsilModules.facebook = {
  network:               'facebook',
  collected:             [],
  _seen:                 {},
  _scraping:             false,
  _lastAnnouncedProfile: '',

  // ──────────────────────────────────────────────────────────────────────────
  // Tipo de página
  // ──────────────────────────────────────────────────────────────────────────
  getPageType: function () {
    var p = location.pathname
    var s = location.search

    // Lista de amigos: /username/friends o /profile.php?id=X&sk=friends|sk=friends_all
    if (/sk=friends(_all)?/.test(s) || /\/friends\/?$/.test(p)) return 'friends'

    // Perfil por ID numérico
    if (p === '/profile.php' && /id=\d+/.test(s)) return 'profile'

    // Perfil por nombre de usuario (excluir rutas de sistema)
    if (/^\/[^/]+\/?$/.test(p) && p !== '/' && !this._isSystemPath(p)) return 'profile'

    if (/^\/groups\//.test(p)) return 'group'
    return 'other'
  },

  _isSystemPath: function (p) {
    // Rutas que NO son perfiles (cuando el path es de un solo segmento)
    var seg = p.replace(/^\/|\/$/g, '').split('/')[0].toLowerCase()
    var system = ['pages','groups','events','watch','marketplace','reels','stories',
                  'home','login','share','messages','notifications','settings','saved',
                  'memories','gaming','live','fundraisers','jobs','weather','crisisresponse',
                  'business','policies','legal','help','hashtag','public','search','me',
                  'friends','profile.php','bookmarks','games','flx','privacy','ads',
                  'lite','help','community','recover']
    return system.indexOf(seg) !== -1
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Botones del panel
  // ──────────────────────────────────────────────────────────────────────────
  getActions: function () {
    var type = this.getPageType()
    var a    = []
    if (type === 'profile') {
      a.push({ id: 'profile', label: '⊕ Reporte del perfil (TXT)' })
      a.push({ id: 'friends', label: '⊕ Extraer amigos → XLSX' })
    } else if (type === 'friends') {
      a.push({
        id:    'friends',
        label: this._scraping ? '⏳ Scraping en curso...' : '⊕ Extraer amigos → XLSX',
      })
    } else if (type === 'group') {
      a.push({ id: 'profile', label: '⊕ Reporte del grupo (TXT)' })
    }
    return a
  },

  runAction: function (id) {
    switch (id) {
      case 'profile': this._actionProfile(); break
      case 'friends': this._actionFriends(); break
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Panel stats
  // ──────────────────────────────────────────────────────────────────────────
  stats: function () {
    var p = 0, c = 0
    this.collected.forEach(function (i) {
      if      (i._type === 'profile') p++
      else if (i._type === 'contact') c++
    })
    return { profiles: p, posts: 0, contacts: c }
  },
  getItems: function () { return this.collected },
  clear: function () {
    this.collected = []; this._seen = {}; this._lastAnnouncedProfile = ''
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // ══════════════════════════════════════════════════════════════════════════
  // _getEntity — equivalente exacto a TM_getId de Sirius
  // Re-fetcha la HTML de la URL actual (Facebook es SPA con React Routing → el
  // DOM en memoria puede no corresponder con la URL visible) y extrae:
  //   • fbid       (número estable)
  //   • fbtype     ('Profile ID' | 'Page ID' | 'Group ID')
  //   • fbtitle    (título visible de la página)
  //   • token      (fb_dtsg para llamadas POST a /api/graphql)
  // ══════════════════════════════════════════════════════════════════════════
  _getEntity: function () {
    var url = location.href

    // Caso especial: dentro de un grupo, perfil mostrado como /groups/X/user/Y
    var parts = location.pathname.split('/')
    var idxUser = parts.indexOf('user'), idxGroups = parts.indexOf('groups')
    if (idxUser > -1 && idxGroups > -1) {
      var tmpId = parts[idxUser + 1]
      if (tmpId) url = 'https://www.facebook.com/profile.php?id=' + tmpId
    }

    // Pre-extracción de ID desde la URL (prioritario sobre regex en HTML).
    // Razón: cuando estamos logueados, el HTML fetcheado a veces contiene primero
    // el userID de la sesión (el visitante), no el del perfil consultado. Si la
    // URL ya trae el ID explícito, usarlo es 100% fiable.
    var urlId = null, urlIdType = null
    if (location.pathname === '/profile.php') {
      var pm = location.search.match(/[?&]id=(\d+)/)
      if (pm) { urlId = pm[1]; urlIdType = 'Profile ID' }
    } else if (/^\/groups\/(\d+)/.test(location.pathname)) {
      urlId = (location.pathname.match(/^\/groups\/(\d+)/) || [])[1]
      urlIdType = 'Group ID'
    } else if (/^\/(\d{6,})\/?$/.test(location.pathname)) {
      urlId = (location.pathname.match(/^\/(\d{6,})/) || [])[1]
      urlIdType = 'Profile ID'
    }

    return fetch(url, {
      credentials: 'include',
      headers: { 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9' },
    })
      .then(function (r) { return r.text() })
      .then(function (html) {
        var entity = { fbid: null, fbtype: null, fbtitle: null, token: null }

        // Título
        var titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
        if (titleMatch) entity.fbtitle = titleMatch[1].split(' | ')[0].trim()

        // Si la URL traía el ID, usarlo. Si no, caer al regex sobre HTML
        // (esto sigue siendo necesario para URLs /username sin ID explícito).
        if (urlId) {
          entity.fbid   = urlId
          entity.fbtype = urlIdType
          // Detección de Page: aunque la URL tenga formato Profile, el HTML puede
          // marcar que en realidad es una Page (Facebook desde 2024 usa userID
          // también para Pages).
          if (urlIdType === 'Profile ID' &&
              html.indexOf('"profile_type_name_for_content":"PAGE"') !== -1) {
            entity.fbtype = 'Page ID'
          }
        } else {
          var idMatch = html.match(/"(userID|groupID|pageID)":"(\d+)"/)
          if (!idMatch) {
            // Sin ID en URL ni en HTML: aún así devolvemos token si lo encontramos
            var tokM = html.match(/"DTSGInitData"[^{]*\{"token":"([^"]+)"/)
            if (tokM) entity.token = tokM[1]
            return entity
          }
          var rawType = idMatch[1]
          entity.fbid = idMatch[2]
          if (html.indexOf('"profile_type_name_for_content":"PAGE"') !== -1 || rawType === 'pageID') {
            entity.fbtype = 'Page ID'
          } else if (rawType === 'groupID') {
            entity.fbtype = 'Group ID'
          } else {
            entity.fbtype = 'Profile ID'
          }
        }

        // fb_dtsg token (necesario para POST a /api/graphql)
        var tokenMatch = html.match(/"DTSGInitData"[^{]*\{"token":"([^"]+)"/)
        if (tokenMatch) entity.token = tokenMatch[1]

        return entity
      })
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIÓN: Reporte de perfil
  //   1. _getEntity()          → fbid, fbtype, fbtitle, token
  //   2. CometHovercardQueryRendererQuery → name, join_time, profile_url, foto
  //   3. Extracción del DOM    → bio, vive en, origen, trabajo, estudios
  //   4. TXT + descarga
  // ══════════════════════════════════════════════════════════════════════════
  _actionProfile: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('Facebook: identificando entidad…')

    self._getEntity().then(function (entity) {
      if (!entity || !entity.fbid) {
        NarsilPanel && NarsilPanel.log(
          'Facebook: no se pudo identificar el perfil/página/grupo en esta URL.', 'err')
        return
      }
      NarsilPanel && NarsilPanel.log(
        'Facebook: ' + entity.fbtype + ' ' + entity.fbid + ' detectado, consultando GraphQL…')

      // El hovercard sólo tiene sentido para Profile/Page (no Group)
      var hovercardP = (entity.fbtype === 'Profile ID' || entity.fbtype === 'Page ID')
        ? self._fetchHovercard(entity)
        : Promise.resolve(null)

      hovercardP.then(function (hc) {
        var data = self._buildProfileTxt(entity, hc)
        if (!data || data.length <= 2) {
          NarsilPanel && NarsilPanel.log('Facebook: extracción vacía.', 'err')
          return
        }
        var safeName = (entity.fbtitle || entity.fbid || 'perfil')
          .replace(/\s+/g, '_').replace(/[^\w.\-]/g, '').slice(0, 60)
        self._sendDownload(
          safeName + '_facebook_profile.txt',
          data.join('\n'),
          'text/plain;charset=utf-8'
        )
        NarsilPanel && NarsilPanel.log(
          'Facebook: reporte de "' + (entity.fbtitle || entity.fbid) + '" descargado.', 'ok')
      })
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('Facebook: error al obtener perfil — ' + e.message, 'err')
    })
  },

  // POST a /api/graphql/ con CometHovercardQueryRendererQuery (≡ Sirius TM_getFbUserData)
  // Devuelve { id, name, join_time, url, profile_url, profile_picture } o null.
  _fetchHovercard: function (entity) {
    if (!entity.token) return Promise.resolve(null)

    var variables = {
      actionBarRenderLocation: 'WWW_COMET_HOVERCARD',
      context:                 'MARKETPLACE',
      entityID:                entity.fbid,
      includeTdaInfo:          false,
      scale:                   1.5,
      '__relay_internal__pv__GlobalPanelEnabledrelayprovider':                              false,
      '__relay_internal__pv__CometHovercardCommunityPanelBadgingStylerelayprovider':        'HIGHLIGHT_UPDATE_ONLY',
      '__relay_internal__pv__CometHovercardCommunityPanelBadgingQueryMethodrelayprovider':  'RECENT_UNSEEN',
    }

    var body = '__a=1&__comet_req=15'
      + '&fb_dtsg=' + encodeURIComponent(entity.token)
      + '&fb_api_req_friendly_name=CometHovercardQueryRendererQuery'
      + '&variables=' + encodeURIComponent(JSON.stringify(variables))
      + '&doc_id=5274216736008181'

    return fetch('https://www.facebook.com/api/graphql/', {
      method:      'POST',
      credentials: 'include',
      headers:     {
        'Content-Type':        'application/x-www-form-urlencoded',
        'X-Fb-Friendly-Name':  'CometHovercardQueryRendererQuery',
      },
      body: body,
    })
      .then(function (r) { return r.text() })
      .then(function (txt) {
        // Facebook a veces devuelve "for (;;);" como prefijo anti-XSSI
        var clean = txt.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, '')
        try {
          var json = JSON.parse(clean)
          return ((((json.data || {}).node || {}).comet_hovercard_renderer || {}).user) || null
        } catch (_) { return null }
      })
      .catch(function () { return null })
  },

  // Construye el TXT combinando hovercard (datos crudos) + DOM (Intro/About)
  _buildProfileTxt: function (entity, hc) {
    var data = []

    // Cabecera
    data.push('🆔 ID: '   + entity.fbid)
    data.push('📋 Tipo: ' + (entity.fbtype || 'Desconocido'))

    // Datos del hovercard (≡ TM_getFbUserData)
    if (hc) {
      if (hc.name)         data.push('👤 Nombre: '         + hc.name)
      if (hc.url)          data.push('🔗 URL canónica: '   + hc.url)
      if (hc.profile_url)  data.push('🔗 URL del perfil: ' + hc.profile_url)
      if (hc.join_time && parseInt(hc.join_time) > 0) {
        var d = new Date(parseInt(hc.join_time) * 1000)
        data.push('📅 Fecha de incorporación: ' + d.toISOString().slice(0, 10))
      }
      if (hc.profile_picture && hc.profile_picture.uri) {
        data.push('🖼️ Foto de perfil: ' + hc.profile_picture.uri)
      }
    } else if (entity.fbtitle) {
      data.push('👤 Nombre: ' + entity.fbtitle)
    }

    // URL actual (limpia)
    data.push('🌐 URL actual: ' + location.href.split('?')[0]
      + (location.search.match(/[?&]id=\d+/) ? location.search.match(/[?&]id=\d+/)[0].replace(/^&/, '?') : ''))

    // Foto HD via Graph API público (truco de Sirius TM_largePhoto)
    if (entity.fbtype === 'Profile ID' || entity.fbtype === 'Page ID') {
      data.push('🖼️ Foto HD: https://graph.facebook.com/' + entity.fbid + '/picture?width=5000')
    }

    // Datos visibles del DOM (Intro/About — ES + EN)
    var dom = this._extractFromDOM()
    if (dom.length) {
      data.push('') // separador
      dom.forEach(function (line) { data.push(line) })
    }

    data.push('')
    data.push('Generado por NARSIL Intelligence Collector — ' + new Date().toISOString())
    return data
  },

  // Extracción del Intro/About + redes vinculadas. Estrategia:
  //   • JSON embebido es la fuente PRIMARIA (estable, sin layout)
  //   • innerText es FALLBACK solo cuando el JSON no tiene el campo
  //   • Bio: SOLO desde JSON ("bio_text") — el patrón texto da falsos positivos
  //     ("Información de contacto" + línea siguiente devolvía "Amigos", etc.)
  _extractFromDOM: function () {
    var lines = []
    var texto = (document.body && document.body.innerText) || ''
    var html  = document.documentElement.innerHTML
    var self  = this

    function decodeJsonStr(s) {
      return s.replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
        return String.fromCharCode(parseInt(h, 16))
      })
    }

    // ── Bio: SOLO desde JSON. El patrón texto producía "Bio: Amigos" (falso) ──
    var bioJ = html.match(/"bio_text"\s*:\s*\{[^{}]*?"text"\s*:\s*"([^"\\]{1,500})"/)
    if (bioJ) {
      var bio = decodeJsonStr(bioJ[1].trim())
      if (bio) lines.push('📝 Bio: ' + bio)
    }

    // ── Vive en (current_city): JSON primero ─────────────────────────────────
    var ciudad = ''
    var ccJ = html.match(/"current_city"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"\\]+)"/)
    if (ccJ) ciudad = decodeJsonStr(ccJ[1].trim())
    if (!ciudad) {
      var ccT = texto.match(/(?:Vive en|Lives in)\s+([\p{L} ,.\-]{3,100})/u)
      if (ccT) ciudad = ccT[1].trim()
    }
    if (ciudad) lines.push('🏠 Vive en: ' + ciudad)

    // ── Origen (hometown): JSON primero ──────────────────────────────────────
    var origen = ''
    var htJ = html.match(/"hometown"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"\\]+)"/)
    if (htJ) origen = decodeJsonStr(htJ[1].trim())
    if (!origen) {
      var htT = html.match(/"text":"(?:De|From) ([^"]{2,100}?)"/)
      if (htT && self._isLikelyPlace(htT[1])) origen = decodeJsonStr(htT[1].trim())
    }
    if (origen) lines.push('🌍 Lugar de origen: ' + origen)

    // ── Trabajo (employer del primer work entry) ─────────────────────────────
    var trabajo = ''
    var emJ = html.match(/"employer"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"\\]+)"/)
    if (emJ) trabajo = decodeJsonStr(emJ[1].trim())
    if (!trabajo) {
      var emT = texto.match(/(?:Trabaja en|Works at)\s+([\p{L} ,.\-&]{3,100})/u)
      if (emT) trabajo = emT[1].trim()
    }
    if (trabajo) lines.push('💼 Trabajo: ' + trabajo)

    // ── Trabajo anterior (segundo employer) ──────────────────────────────────
    var trabajoPrev = ''
    var emAll = html.match(/"employer"\s*:\s*\{[^{}]*?"name"\s*:\s*"[^"\\]+"/g) || []
    if (emAll.length > 1) {
      var snd = emAll[1].match(/"name"\s*:\s*"([^"\\]+)"/)
      if (snd) trabajoPrev = decodeJsonStr(snd[1].trim())
    }
    if (!trabajoPrev) {
      var tpT = texto.match(/(?:Trabajó en|Worked at|Trabajaba en)\s+([\p{L} ,.\-&]{3,100})/u)
      if (tpT) trabajoPrev = tpT[1].trim()
    }
    if (trabajoPrev) lines.push('💼 Trabajo anterior: ' + trabajoPrev)

    // ── Estudios (school) ────────────────────────────────────────────────────
    var estudios = ''
    var schJ = html.match(/"school"\s*:\s*\{[^{}]*?"name"\s*:\s*"([^"\\]+)"/)
    if (schJ) estudios = decodeJsonStr(schJ[1].trim())
    if (!estudios) {
      var schT = texto.match(/(?:Estudió en|Studied at|Estudia en|Studies at)\s+([\p{L} ,.\-]{3,100})/u)
      if (schT) estudios = schT[1].trim()
    }
    if (estudios) lines.push('🎓 Estudios: ' + estudios)

    // ── Estado civil + pareja ────────────────────────────────────────────────
    var rsCodes = {
      MARRIED: 'Casado/a', SINGLE: 'Soltero/a', IN_RELATIONSHIP: 'En relación',
      ENGAGED: 'Comprometido/a', SEPARATED: 'Separado/a', DIVORCED: 'Divorciado/a',
      WIDOWED: 'Viudo/a', COMPLICATED: 'Es complicado',
      IN_OPEN_RELATIONSHIP: 'En relación abierta',
      IN_CIVIL_UNION: 'Unión civil', IN_DOMESTIC_PARTNERSHIP: 'Pareja de hecho',
    }
    var civil = '', pareja = ''
    var rsM = html.match(/"relationship_status":"([A-Z_]+)"/)
    if (rsM && rsCodes[rsM[1]]) civil = rsCodes[rsM[1]]
    var matrM = texto.match(/(?:Casado con|Casada con|Married to)\s+([\p{L} ,.\-]{3,100})/u)
    if (matrM) { pareja = matrM[1].trim(); if (!civil) civil = 'Casado/a' }
    else {
      var relM = texto.match(/(?:Tiene una relación con|En una relación con|In a relationship with)\s+([\p{L} ,.\-]{3,100})/u)
      if (relM) { pareja = relM[1].trim(); if (!civil) civil = 'En relación' }
    }
    if (!civil) {
      var soltM = texto.match(/(?:^|\n)(Soltero|Soltera|Single|Separado|Separada|Divorciado|Divorciada|Viudo|Viuda)(?:\n|$)/u)
      if (soltM) civil = soltM[1]
    }
    if (civil)  lines.push('💍 Estado civil: ' + civil)
    if (pareja) lines.push('💕 Pareja: '       + pareja)

    // ── Cumpleaños (con año si disponible, mes en español) ───────────────────
    var monthNames = ['enero','febrero','marzo','abril','mayo','junio',
                      'julio','agosto','septiembre','octubre','noviembre','diciembre']
    var bdayPats = [
      /"birthdate"\s*:\s*\{[^}]*?"day"\s*:\s*(\d+)[^}]*?"month"\s*:\s*(\d+)(?:[^}]*?"year"\s*:\s*(\d+))?/,
      /"birthday_field"[^{]*\{[^}]*?"day"\s*:\s*(\d+)[^}]*?"month"\s*:\s*(\d+)(?:[^}]*?"year"\s*:\s*(\d+))?/,
      /"birth_date"\s*:\s*\{[^}]*?"day"\s*:\s*(\d+)[^}]*?"month"\s*:\s*(\d+)(?:[^}]*?"year"\s*:\s*(\d+))?/,
    ]
    for (var bi = 0; bi < bdayPats.length; bi++) {
      var bm = html.match(bdayPats[bi])
      if (!bm) continue
      var dd = parseInt(bm[1]), mo = parseInt(bm[2]), yr = bm[3] ? parseInt(bm[3]) : null
      var bdayStr = dd + ' de ' + (monthNames[mo - 1] || mo) + (yr ? ' de ' + yr : '')
      lines.push('🎂 Cumpleaños: ' + bdayStr)
      break
    }

    // ── Género ───────────────────────────────────────────────────────────────
    var gM = html.match(/"gender":"([^"]+)"/)
    if (gM && gM[1] !== 'UNKNOWN') lines.push('⚧ Género: ' + gM[1])

    // ── Información de contacto: Instagram, X, Web, Email ────────────────────
    var contactos = self._extractContactos(html)
    contactos.forEach(function (c) { lines.push(c) })

    return lines
  },

  // Extrae enlaces a redes sociales y datos de contacto del HTML embebido.
  // Devuelve array de líneas con emoji + plataforma + valor.
  //
  // Notas críticas tras pruebas:
  //   • Facebook envuelve enlaces externos en `l.facebook.com/l.php?u=ENCODED_URL`,
  //     por lo que Instagram aparece como `instagram.com%2FUSERNAME` (con `%2F`),
  //     no como `instagram.com/USERNAME`. Patrón debe aceptar ambos.
  //   • Email a menudo está en el texto del bio ("📧 Para anuncios: x@y.com"),
  //     no en un campo `"email"` JSON. Hay que buscarlo en TODO el HTML.
  _extractContactos: function (html) {
    var lines = []
    function decode(s) {
      return s.replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
        return String.fromCharCode(parseInt(h, 16))
      })
    }

    // Instagram (linked account JSON o URL directa o URL codificada en redirector)
    var igPats = [
      /"instagram_username"\s*:\s*"([a-zA-Z0-9_.]{1,30})"/,
      /instagram\.com(?:\/|%2F)([a-zA-Z0-9_.]{1,30})/i,
    ]
    var igBlacklist = /^(p|reel|reels|stories|explore|directory|web|accounts|tv|developer|about|legal|privacy|terms|tags?|invite|emails?|signup|login)$/i
    for (var i = 0; i < igPats.length; i++) {
      var im = html.match(igPats[i])
      if (im && im[1] && !igBlacklist.test(im[1])) {
        lines.push('📷 Instagram: @' + im[1]); break
      }
    }

    // YouTube (handle @user, channel/UC..., c/Custom, user/Legacy)
    var ytPats = [
      /youtube\.com(?:\/|%2F)(?:@|c\/|c%2F|channel\/|channel%2F|user\/|user%2F)?([a-zA-Z0-9_.\-]{1,50})/i,
    ]
    var ytBlacklist = /^(watch|results|embed|shorts|playlist|feed|gaming|sports|music|trending|premium|signin|signup|t|account|reporthistory|paid_memberships|new|live|hashtag)$/i
    for (var y = 0; y < ytPats.length; y++) {
      var ym = html.match(ytPats[y])
      if (ym && ym[1] && !ytBlacklist.test(ym[1])) {
        lines.push('📺 YouTube: ' + ym[1]); break
      }
    }

    // X / Twitter
    var twPats = [
      /"twitter"\s*:\s*"([a-zA-Z0-9_]{1,15})"/,
      /(?:twitter|x)\.com(?:\/|%2F)([a-zA-Z0-9_]{1,15})/i,
    ]
    var twBlacklist = /^(home|search|explore|notifications|messages|i|intent|share|about|tos|status|compose|account|signup|login)$/i
    for (var t = 0; t < twPats.length; t++) {
      var tm = html.match(twPats[t])
      if (tm && tm[1] && !twBlacklist.test(tm[1])) {
        lines.push('🐦 X / Twitter: @' + tm[1]); break
      }
    }

    // Threads (Meta)
    var thPats = [
      /threads\.(?:com|net)(?:\/|%2F)@?([a-zA-Z0-9_.]{1,30})/i,
    ]
    for (var th = 0; th < thPats.length; th++) {
      var thm = html.match(thPats[th])
      if (thm && thm[1] && !/^(home|search|explore|intent|login|signup|terms|privacy)$/i.test(thm[1])) {
        lines.push('🧵 Threads: @' + thm[1]); break
      }
    }

    // Sitio web (campo JSON específico)
    var webM = html.match(/"websites?"\s*:\s*\[\s*"(https?:\/\/[^"\\]+)"/)
    if (webM) lines.push('🌐 Web: ' + decode(webM[1]))

    // Email: buscar en TODO el HTML, no solo en campos JSON. Filtrar dominios
    // de plataforma (Facebook, Instagram, etc.) y placeholders.
    var allEmails = html.match(/[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
    var blockedDomains = /^(.*\.)?(facebook|fbcdn|fbsbx|messenger|fb|workplace|whatsapp|instagram|sentry|sentry-cdn|noreply|example|ejemplo|test|correo|fburl)\.(com|net|org|io|dev)$/i
    var validEmails = []
    var seen = {}
    allEmails.forEach(function (e) {
      var d = (e.split('@')[1] || '').toLowerCase()
      if (blockedDomains.test(d)) return
      if (seen[e.toLowerCase()]) return
      seen[e.toLowerCase()] = true
      validEmails.push(decode(e))
    })
    if (validEmails.length) lines.push('📧 Email: ' + validEmails[0])

    return lines
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIÓN: Extraer amigos
  //   • Si no estamos en /friends → navegar (sessionStorage activa auto-trigger)
  //   • Si estamos en /friends → scroll + extracción de anchors hacia perfiles
  //   • Cada amigo: name + ID/username + URL del perfil
  //   • XLSX final con columnas Nombre / ID / URL
  // ══════════════════════════════════════════════════════════════════════════
  _actionFriends: function () {
    if (this._scraping) return
    if (this.getPageType() === 'friends') {
      this._scrapeFriends()
      return
    }

    // Necesitamos navegar a la pestaña de amigos. Obtener fbid primero.
    var self = this
    self._getEntity().then(function (entity) {
      if (!entity || !entity.fbid || entity.fbtype !== 'Profile ID') {
        NarsilPanel && NarsilPanel.log(
          'Facebook: solo se puede extraer la lista de amigos de un perfil personal.', 'err')
        return
      }
      sessionStorage.setItem('narsil_fb_auto_friends', '1')
      location.href = 'https://www.facebook.com/profile.php?id=' + entity.fbid + '&sk=friends'
    })
  },

  _scrapeFriends: function () {
    var self = this
    if (this._scraping) return
    this._scraping = true
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    NarsilPanel && NarsilPanel.log('Facebook: scraping de amigos iniciado, desplazando lista…')

    // Pre-cachear fb_dtsg en background — lo necesitaremos para hacer hovercard
    // queries por amigo durante el enrichment (fecha de incorporación, foto, etc).
    // Fire-and-forget: el harvest tarda minutos, _getEntity tarda 1-2s, así que
    // self._dtsg estará listo mucho antes de empezar a llamar al hovercard.
    self._getEntity()
      .then(function (entity) { self._dtsg = (entity && entity.token) || null })
      .catch(function () { self._dtsg = null })

    var collected  = {}
    var noNew      = 0
    var iter       = 0
    var MAX_ITER   = 80
    var MAX_NO_NEW = 5

    function harvest() {
      var prev = Object.keys(collected).length
      document.querySelectorAll('a[href]').forEach(function (a) {
        var href = a.href
        if (!href || href.indexOf('facebook.com') === -1) return
        // Filtrar a anchors que enlazan a perfiles (profile.php?id=N o /username)
        var m = href.match(/facebook\.com\/(?:profile\.php\?id=(\d+)|([\w.]+))(?:[?#&].*)?$/)
        if (!m) return

        // Tres formatos de URL de perfil que usa Facebook actualmente:
        //   • /profile.php?id=N         → m[1] = N         (siempre ID numérico)
        //   • /N (donde N es numérico)  → m[2] = N         (también ID numérico — sin vanity URL)
        //   • /username                 → m[2] = "texto"   (username de vanidad)
        var profileIdFromUrl = m[1] || (m[2] && /^\d{6,}$/.test(m[2]) ? m[2] : null)
        var usernameFromUrl  = (m[2] && !/^\d+$/.test(m[2])) ? m[2] : null
        var key              = profileIdFromUrl || usernameFromUrl
        if (!key) return
        if (self._isSystemPath('/' + key)) return
        if (key.indexOf('.php') >= 0) return       // /profile.php sin id, /home.php, etc.

        var name = a.innerText.trim()
        if (!name) return
        // Descartar etiquetas que no son nombres de personas:
        if (name.length < 2 || name.length > 100) return
        if (/^\d+\s*(amigos?|amigas?)\s*en\s*com[uú]n/i.test(name)) return
        if (/^\d+\s*mutual\s*friends?/i.test(name)) return
        if (/^[\d\s]+$/.test(name)) return                                 // sólo números
        if (/^(seguir|follow|añadir|add|message|mensaje|like|me gusta)$/i.test(name)) return

        // Evitar duplicados (misma URL puede aparecer en varias zonas con distintos textos)
        if (collected[key]) {
          // Quedarse con el nombre más largo (suele ser el real, no el alias)
          if (name.length > collected[key].name.length) collected[key].name = name
          return
        }
        collected[key] = {
          name:             name,
          profileIdFromUrl: profileIdFromUrl,   // null si la URL es /username
          usernameFromUrl:  usernameFromUrl,    // null si la URL es /profile.php?id=N
          href:             profileIdFromUrl
            ? 'https://www.facebook.com/profile.php?id=' + profileIdFromUrl
            : 'https://www.facebook.com/' + usernameFromUrl,
        }
      })
      var added = Object.keys(collected).length - prev
      return added
    }

    function step() {
      var added = harvest()
      if (added === 0) noNew++; else noNew = 0
      var total = Object.keys(collected).length

      if (iter >= MAX_ITER || noNew >= MAX_NO_NEW) {
        NarsilPanel && NarsilPanel.log(
          'Facebook: scroll terminado — ' + total + ' amigos detectados.')
        return self._enrichAndExport(Object.values(collected))
      }

      window.scrollTo(0, document.body.scrollHeight)
      iter++
      if (iter % 5 === 0) {
        NarsilPanel && NarsilPanel.log(
          'Facebook: ' + total + ' amigos detectados (iter ' + iter + ')…')
      }
      setTimeout(step, 1500)
    }

    step()
  },

  // Para cada amigo: fetch a su perfil → userID real + ciudad / origen / trabajo.
  // El ID numérico SIEMPRE existe (lo extraemos del HTML, no de la URL),
  // el username puede no existir (perfiles sólo identificados por número).
  // Coste: ~1.5s por amigo. Limitamos a 200 para no abusar.
  _enrichAndExport: function (amigos) {
    var self = this
    if (!amigos.length) {
      NarsilPanel && NarsilPanel.log('Facebook: no se detectaron amigos.', 'err')
      self._scraping = false
      NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
      return
    }

    // Límite por defecto bajo (50) porque cada perfil abre una pestaña en background
    // y espera ~10s para que React hidrate. 50 amigos ≈ 8-9 minutos.
    var LIMIT = 50
    if (amigos.length > LIMIT) {
      NarsilPanel && NarsilPanel.log(
        'Facebook: limitando a los primeros ' + LIMIT + ' amigos (de ' + amigos.length + ').')
      amigos = amigos.slice(0, LIMIT)
    }
    var minEst = Math.ceil(amigos.length * 10 / 60)
    NarsilPanel && NarsilPanel.log(
      'Facebook: abriendo ' + amigos.length + ' perfiles en pestañas de fondo ' +
      '(~10s cada uno, ≈' + minEst + ' min totales). Se irán abriendo y cerrando ' +
      'pestañas — no las cierres manualmente.')

    var rows = []
    var idx  = 0

    function next() {
      if (idx >= amigos.length) {
        if (!rows.length) {
          NarsilPanel && NarsilPanel.log('Facebook: no se obtuvo nada exportable.', 'err')
          self._scraping = false
          NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
          return
        }
        var ts    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        var bytes = NarsilExport.toXLSX(rows)
        var b64   = NarsilExport.uint8ToBase64(bytes)
        self._sendDownloadBinary(
          'fb_amigos_' + ts + '.xlsx',
          b64,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        NarsilPanel && NarsilPanel.log(
          'Facebook: ' + rows.length + ' amigos exportados.', 'ok')
        self._scraping = false
        NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
        return
      }

      var amigo = amigos[idx++]
      NarsilPanel && NarsilPanel.log(
        'Facebook: extrayendo "' + amigo.name + '" (' + idx + '/' + amigos.length + ')…')

      // 1. Tab extraction (DOM vivo): id + bio + lugar de residencia/origen.
      self._fetchPerfilCompleto(amigo.href, amigo.profileIdFromUrl).then(function (det) {
        var realId = amigo.profileIdFromUrl || det.id || ''

        // 2. Hovercard GraphQL (en paralelo si tenemos id + token): join_time + foto
        var hcPromise = (realId && self._dtsg)
          ? self._fetchHovercard({ fbid: realId, token: self._dtsg })
          : Promise.resolve(null)

        hcPromise.then(function (hc) {
          // Componer fila con todas las columnas del reporte individual
          rows.push(self._buildFriendRow(amigo, realId, det, hc))
          setTimeout(next, 800)
        })
      }).catch(function () {
        rows.push(self._buildFriendRow(amigo, amigo.profileIdFromUrl || '', {}, null))
        setTimeout(next, 800)
      })
    }

    next()
  },

  // Construye la fila del XLSX para un amigo. El reporte de conectividad se
  // limita a los identificadores y campos de contexto que han resultado fiables.
  _buildFriendRow: function (amigo, realId, det, hc) {
    det = det || {}
    var fechaInc = ''
    if (hc && hc.join_time && parseInt(hc.join_time) > 0) {
      fechaInc = new Date(parseInt(hc.join_time) * 1000).toISOString().slice(0, 10)
    }
    var fotoHD = realId
      ? 'https://graph.facebook.com/' + realId + '/picture?width=5000'
      : NarsilExport.missing()

    return {
      'Nombre':              amigo.name,
      'ID':                  realId || NarsilExport.missing('no detectado'),
      'Username':            amigo.usernameFromUrl || NarsilExport.missing('perfil sin username'),
      'Perfil':              amigo.href,
      'Foto HD':             fotoHD,
      'Fecha incorporación': fechaInc           || NarsilExport.missing(),
      'Bio':                 det.bio            || NarsilExport.missing(),
      'Vive en':             det.ciudad         || NarsilExport.missing(),
      'Origen':              det.origen         || NarsilExport.missing(),
    }
  },

  // Extracción de un perfil completo → { id, bio, ciudad, origen }.
  //
  // ESTRATEGIA: pestaña en segundo plano + DOM vivo
  //   www.facebook.com es una SPA React que solo trae "skeleton" en HTML inicial;
  //   los campos Bio / Vive en / De se hidratan client-side via GraphQL.
  //   Ningún fetch programático (ni a www, ni a /about, ni a mbasic) los devuelve
  //   en SSR. La única forma fiable es lo que hace el usuario manualmente:
  //   visitar la página, dejar que React la hidrate, y leer del DOM vivo.
  //
  //   El background.js abre cada perfil en pestaña no activa (background tab),
  //   espera ~5s tras 'complete' para que React acabe de hidratar, ejecuta
  //   código de extracción vía tabs.executeScript, y cierra la pestaña.
  //   Coste: ~10s por amigo. Por eso el límite por defecto es 50.
  _fetchPerfilCompleto: function (url, profileIdFromUrl) {
    return browser.runtime.sendMessage({
      type: 'FB_EXTRACT_PROFILE_IN_TAB',
      url:  url,
    }).then(function (response) {
      var d = (response && response.data) || {}
      return {
        id:      profileIdFromUrl || d.id || '',
        bio:     d.bio     || '',
        ciudad:  d.ciudad  || '',
        origen:  d.origen  || '',
      }
    }).catch(function () {
      return {
        id:      profileIdFromUrl || '',
        bio:     '',
        ciudad:  '',
        origen:  '',
      }
    })
  },

  // ── Filtro de falsos positivos para campos extraídos ──────────────────────
  // El HTML de Facebook contiene MUCHO ruido en `"text":"..."` (créditos publicitarios,
  // promos, marketing). Aceptamos sólo cadenas que parecen lugares/instituciones reales:
  //   • Sin secuencias \uXXXX literales (indica JSON crudo, no texto para mostrar)
  //   • Sin símbolos de moneda
  //   • Sin empezar por dígito
  //   • Sin palabras clave de marketing/ads
  //   • Empezando por una letra (cualquier alfabeto)
  _isLikelyPlace: function (text) {
    if (!text) return false
    text = text.trim()
    if (!text) return false
    if (/\\u[0-9a-fA-F]{4}/.test(text)) return false
    if (/[€$£¥₹₩]/.test(text)) return false
    if (/^\d/.test(text)) return false
    if (/\b(credit|ads?|USD|EUR|GBP|JPY|promo|discount|bonus|coupon|spend|cost|invest|fee|free|trial|month|year|day)\b/i.test(text)) return false
    if (!/^[\p{L}]/u.test(text)) return false
    return true
  },

  // ══════════════════════════════════════════════════════════════════════════
  // _announceProfile — al cambiar de URL, identifica el perfil y lo registra
  // en el panel (≡ TM_showId pero sin clipboard, similar al anuncio de región
  // de TikTok). Usa solo el DOM (sin fetch) para ser rápido.
  // ══════════════════════════════════════════════════════════════════════════
  _announceProfile: function () {
    var type = this.getPageType()
    if (type !== 'profile' && type !== 'group') return
    var key = location.pathname + location.search
    if (key === this._lastAnnouncedProfile) return
    this._lastAnnouncedProfile = key

    var self = this
    setTimeout(function () {
      var html  = document.documentElement.innerHTML
      var idM   = html.match(/"(userID|groupID|pageID)":"(\d+)"/)
      var titM  = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      if (!idM) return

      var id    = idM[2]
      var rawT  = idM[1]
      var label = 'Profile ID'
      if (html.indexOf('"profile_type_name_for_content":"PAGE"') !== -1 || rawT === 'pageID') label = 'Page ID'
      else if (rawT === 'groupID') label = 'Group ID'

      var titulo = titM ? titM[1].split(' | ')[0].trim() : ''
      var msg    = '🆔 ' + label + ' detectado: ' + id
      if (titulo) msg += ' — ' + titulo
      NarsilPanel && NarsilPanel.log(msg, 'ok')
    }, 2500)
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Captura pasiva (placeholder por ahora — Facebook usa GraphQL pero sus
  // respuestas son streaming NDJSON que el injector actual no parsea bien)
  // ──────────────────────────────────────────────────────────────────────────
  onPageData:       function () {},
  onNetworkRequest: function () {},

  _add: function (item) {
    var key = item._type + ':' + (item.id || item.username)
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Descarga via background.js (no requiere activación de usuario)
  // ──────────────────────────────────────────────────────────────────────────
  _sendDownload: function (filename, content, mimeType) {
    var safe = (filename || 'narsil').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200)
    browser.runtime.sendMessage({
      type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType,
    }).catch(function () {})
  },
  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = (filename || 'narsil').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200)
    browser.runtime.sendMessage({
      type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType,
    }).catch(function () {})
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Watcher de URL — anuncia perfil + auto-trigger de scraping si venimos de
  // pulsar "Extraer amigos" en un perfil (igual patrón que TikTok)
  // ──────────────────────────────────────────────────────────────────────────
  _initObserver: function () {
    var self    = this
    var lastUrl = ''
    setInterval(function () {
      if (location.href === lastUrl) return
      lastUrl = location.href

      // 1. Anuncio del perfil/página/grupo detectado
      self._announceProfile()

      // 2. Auto-trigger de scrape de amigos
      if (self.getPageType() === 'friends'
          && sessionStorage.getItem('narsil_fb_auto_friends') === '1') {
        sessionStorage.removeItem('narsil_fb_auto_friends')
        // Esperar a que el feed inicial cargue
        setTimeout(function () { self._scrapeFriends() }, 4000)
      }
    }, 600)
  },
}

// Auto-inicializar el watcher (document_idle → body ya existe)
if (NarsilDetector.current() === 'facebook') {
  NarsilModules.facebook._initObserver()
}
