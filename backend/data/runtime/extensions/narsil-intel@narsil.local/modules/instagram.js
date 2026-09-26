// NARSIL Intel Collector - modules/instagram.js
// Conservative Instagram collector. Active actions read the visible page/modal
// and use passive JSON captures only as a cache for stable IDs and metrics.
'use strict'

NarsilModules.instagram = {
  network:       'instagram',
  collected:     [],
  _seen:         {},
  _scraping:     false,
  _profileCache: {},
  _postCache:    {},
  _modalOpen:    false,

  getPageType: function () {
    var p = location.pathname || '/'
    if (this._isSensitivePath(p)) return 'sensitive'
    if (this._connectionModalInfo().modal) return 'connections'
    if (/^\/(?:p|reel|tv)\/[^/]+/.test(p)) return 'post'
    if (/^\/stories\//.test(p)) return 'story'
    if (/^\/([A-Za-z0-9._]{1,30})\/?$/.test(p) && p !== '/' && !this._isReservedPath(p)) return 'profile'
    return 'other'
  },

  getActions: function () {
    var type = this.getPageType()
    var a = []
    if (type === 'profile') {
      a.push({ id: 'profile', label: 'Reporte del perfil (TXT)' })
    } else if (type === 'post') {
      a.push({ id: 'post', label: 'Datos de la publicacion (TXT)' })
    } else if (type === 'connections') {
      a.push({
        id: 'connections',
        label: this._scraping ? 'Scraping conexiones...' : 'Scraping conexiones -> XLSX',
      })
    } else if (type === 'sensitive') {
      a.push({ id: 'blocked', label: 'Vista sensible: no extraer' })
    }
    return a
  },

  runAction: function (id) {
    switch (id) {
      case 'profile':     this._actionProfile(); break
      case 'post':        this._actionPost(); break
      case 'connections': this._actionConnections(); break
      case 'blocked':
        NarsilPanel && NarsilPanel.log('Instagram: vista sensible/no soportada. No se extrae contenido.', 'err')
        break
    }
  },

  stats: function () {
    var p = 0, po = 0, c = 0
    this.collected.forEach(function (i) {
      if (i._type === 'profile') p++
      else if (i._type === 'post') po++
      else if (i._type === 'contact') c++
    })
    return { profiles: p, posts: po, contacts: c }
  },

  getItems: function () { return this.collected },

  clear: function () {
    this.collected = []
    this._seen = {}
    this._profileCache = {}
    this._postCache = {}
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // --------------------------------------------------------------------------
  // Active actions
  // --------------------------------------------------------------------------

  _actionProfile: function () {
    var self = this
    var username = this._currentProfileUsername()
    if (!username) {
      NarsilPanel && NarsilPanel.log('Instagram: navega a un perfil primero.', 'err')
      return
    }

    NarsilPanel && NarsilPanel.log('Instagram: preparando reporte de @' + username + '...')
    this._requestPageData(350)
      .then(function () { return self._fetchProfileInfo(username) })
      .then(function () {
        var profile = self._extractProfile(document, username)
        if (!profile.username) {
          NarsilPanel && NarsilPanel.log('Instagram: no se pudo extraer el perfil visible.', 'err')
          return
        }
        self._add(self._profileToSchema(profile))
        self._sendDownload(
          (profile.username || 'instagram_profile') + '_instagram_profile.txt',
          self._profileToText(profile),
          'text/plain;charset=utf-8'
        )
        NarsilPanel && NarsilPanel.log('Instagram: reporte de @' + profile.username + ' descargado.', 'ok')
      })
      .catch(function (e) {
        NarsilPanel && NarsilPanel.log('Instagram: error al preparar perfil - ' + e.message, 'err')
      })
  },

  _actionPost: function () {
    var self = this
    var code = this._currentPostCode()
    if (!code) {
      NarsilPanel && NarsilPanel.log('Instagram: navega a una publicacion primero.', 'err')
      return
    }

    NarsilPanel && NarsilPanel.log('Instagram: preparando publicacion ' + code + '...')
    this._requestPageData(350).then(function () {
      var post = self._extractPost(document, code)
      if (!post || !post.id) {
        NarsilPanel && NarsilPanel.log('Instagram: no se pudo extraer la publicacion visible.', 'err')
        return
      }
      self._add(self._postToSchema(post))
      self._sendDownload(
        post.id + '_instagram_post.txt',
        self._postToText(post),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('Instagram: publicacion ' + post.id + ' descargada.', 'ok')
    })
  },

  _actionConnections: function () {
    var self = this
    if (this._scraping) return

    var info = this._connectionModalInfo()
    if (!info.modal) {
      NarsilPanel && NarsilPanel.log('Instagram: abre manualmente seguidores o seguidos y vuelve a pulsar.', 'err')
      return
    }

    this._scraping = true
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    NarsilPanel && NarsilPanel.log('Instagram: scraping limitado de conexiones iniciado...')

    this._scrollConnectionsLimited(info.container || info.modal, 12).then(function () {
      return self._requestPageData(450)
    }).then(function () {
      info = self._connectionModalInfo()
      var rows = self._extractConnectionRows(info)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Instagram: no se encontraron conexiones visibles.', 'err')
        self._scraping = false
        NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
        return
      }

      rows.forEach(function (row) {
        self._add(NarsilSchema.contact('instagram', {
          id: row.ID && !row.ID.__narsilMissing ? row.ID : null,
          username: row.Usuario && !row.Usuario.__narsilMissing ? row.Usuario : null,
          display_name: row.Nombre && !row.Nombre.__narsilMissing ? row.Nombre : null,
          role: info.role || 'connections',
          avatar_url: row.Avatar && !row.Avatar.__narsilMissing ? row.Avatar : null,
          network_specific: {
            source: 'dom_connections',
            profile_url: row.Perfil,
            is_private: row.Privado,
            is_verified: row.Verificado,
          },
        }))
      })

      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      var bytes = NarsilExport.toXLSX(rows)
      var b64 = NarsilExport.uint8ToBase64(bytes)
      self._sendDownloadBinary(
        'instagram_' + (info.role || 'connections') + '_' + ts + '.xlsx',
        b64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      NarsilPanel && NarsilPanel.log('Instagram: ' + rows.length + ' conexiones exportadas.', 'ok')
      self._scraping = false
      NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('Instagram: error en conexiones - ' + e.message, 'err')
      self._scraping = false
      NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    })
  },

  // --------------------------------------------------------------------------
  // Passive cache
  // --------------------------------------------------------------------------

  onPageData: function (key, data) {
    try {
      if (!data || typeof data !== 'object') return
      this._walkData(data)
    } catch (_) {}
  },

  onNetworkRequest: function (url, body) {
    try {
      if (!body || typeof body !== 'object') return

      if (/\/api\/v1\/users\/\d+\/info/i.test(url) && body.user) {
        this._cacheUser(body.user, 'passive_user_info')
      }

      if (/\/api\/v1\/users\/web_profile_info/i.test(url)) {
        var u = body.data && body.data.user
        if (u) this._cacheUser(u, 'passive_web_profile_info')
      }

      var relMatch = /\/api\/v1\/friendships\/\d+\/(followers|following)/i.exec(url)
      if (relMatch && Array.isArray(body.users)) {
        var role = relMatch[1]
        var self = this
        body.users.forEach(function (u) {
          var user = self._cacheUser(u, 'passive_' + role)
          if (user.username) {
            self._add(NarsilSchema.contact('instagram', {
              id: user.id,
              username: user.username,
              display_name: user.display_name,
              avatar_url: user.avatar_url,
              role: role,
              network_specific: {
                source: 'passive_' + role,
                is_private: user.is_private,
                is_verified: user.verified,
              },
            }))
          }
        })
      }

      if (/\/api\/v1\/feed\/user\//i.test(url) && Array.isArray(body.items)) {
        this._cacheMediaItems(body.items, 'passive_user_feed')
      }

      if (/\/api\/v1\/media\/.+\/info/i.test(url) && Array.isArray(body.items)) {
        this._cacheMediaItems(body.items, 'passive_media_info')
      }

      this._walkData(body)
    } catch (_) {}
  },

  // --------------------------------------------------------------------------
  // Profile extraction
  // --------------------------------------------------------------------------

  _fetchProfileInfo: function (username) {
    var self = this
    if (!username) return Promise.resolve(null)
    var url = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username)
    return fetch(url, { credentials: 'include', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (json) {
        var user = json && json.data && json.data.user
        if (user) return self._cacheUser(user, 'active_web_profile_info')
        return null
      })
      .catch(function () { return null })
  },

  _extractProfile: function (doc, username) {
    doc = doc || document
    username = username || this._currentProfileUsername()
    var scriptUser = this._extractUserFromScripts(doc, username)
    if (scriptUser.username) this._rememberProfile(scriptUser)
    var cache = this._lookupProfile(username)
    var meta = this._profileMeta(doc, username)
    var header = doc.querySelector('main header') || doc.querySelector('header') || doc.querySelector('main')
    var avatar = header ? header.querySelector('img[src]') : doc.querySelector('img[src]')
    var visible = this._profileVisibleText(header, username)

    var profile = {
      id: cache.id || scriptUser.id || '',
      id_source: cache.id ? cache.id_source || 'passive_cache' : (scriptUser.id ? scriptUser.id_source : ''),
      username: username || cache.username || scriptUser.username || '',
      display_name: cache.display_name || scriptUser.display_name || visible.display_name || meta.display_name || '',
      bio: cache.bio || scriptUser.bio || visible.bio || meta.bio || '',
      external_url: cache.external_url || scriptUser.external_url || visible.external_url || '',
      avatar_url: cache.avatar_url || scriptUser.avatar_url || (avatar ? (avatar.currentSrc || avatar.src || avatar.getAttribute('src')) : ''),
      followers: cache.followers != null ? cache.followers : meta.followers,
      following: cache.following != null ? cache.following : meta.following,
      posts: cache.posts != null ? cache.posts : meta.posts,
      verified: cache.verified != null ? cache.verified : (scriptUser.verified != null ? scriptUser.verified : null),
      is_private: cache.is_private != null ? cache.is_private : scriptUser.is_private,
      category: cache.category || scriptUser.category || '',
      profile_url: username ? 'https://www.instagram.com/' + username + '/' : location.href,
      warnings: [],
    }
    if (!profile.id) profile.warnings.push('profile_id_not_found')
    return profile
  },

  _profileMeta: function (doc, username) {
    var out = { followers: null, following: null, posts: null, display_name: '', bio: '' }
    var ogTitle = this._meta(doc, 'property', 'og:title')
    var desc = this._meta(doc, 'name', 'description') || this._meta(doc, 'property', 'og:description')

    if (ogTitle) {
      var tm = ogTitle.match(/^(.+?)\s+\(@[A-Za-z0-9._]+\)/)
      if (tm) out.display_name = tm[1].trim()
    }
    if (desc) {
      var fm = desc.match(/([\d.,]+[KMBkmb]?)\s+(?:Followers|seguidores)/i)
      var fg = desc.match(/([\d.,]+[KMBkmb]?)\s+(?:Following|seguidos|siguiendo)/i)
      var pm = desc.match(/([\d.,]+[KMBkmb]?)\s+(?:Posts|publicaciones)/i)
      out.followers = fm ? this._parseCount(fm[1]) : null
      out.following = fg ? this._parseCount(fg[1]) : null
      out.posts = pm ? this._parseCount(pm[1]) : null
      var bioM = desc.match(/-\s+(.+)$/)
      if (bioM) out.bio = bioM[1].trim()
    }
    return out
  },

  _profileVisibleText: function (root, username) {
    var out = { display_name: '', bio: '', external_url: '' }
    if (!root) return out
    var text = this._text(root)
    var lines = text.split(/\n|(?=@[A-Za-z0-9._]{1,30})/).map(function (s) {
      return s.replace(/\s+/g, ' ').trim()
    }).filter(Boolean)
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (!out.display_name && line && line !== username && line !== '@' + username &&
          !/^(posts|followers|following|publicaciones|seguidores|seguidos|siguiendo)$/i.test(line) &&
          !/^\d/.test(line)) {
        out.display_name = line
        continue
      }
      if (!out.bio && line && line !== out.display_name && !/^@/.test(line) &&
          !/\b(posts|followers|following|publicaciones|seguidores|seguidos|siguiendo)\b/i.test(line) &&
          !/^https?:\/\//i.test(line)) {
        out.bio = line
      }
    }
    var link = root.querySelector('a[href^="http"]:not([href*="instagram.com"])')
    if (link) out.external_url = link.href || link.getAttribute('href')
    return out
  },

  // --------------------------------------------------------------------------
  // Post extraction
  // --------------------------------------------------------------------------

  _extractPost: function (doc, code) {
    doc = doc || document
    code = code || this._currentPostCode()
    var cache = this._lookupPost(code)
    var article = doc.querySelector('article') || doc.querySelector('main')
    var ogDesc = this._meta(doc, 'property', 'og:description') || this._meta(doc, 'name', 'description')
    var ogImage = this._meta(doc, 'property', 'og:image')
    var ogVideo = this._meta(doc, 'property', 'og:video')
    var text = cache.content || this._extractCaption(article, ogDesc)
    var author = cache.author_username || this._extractAuthorFromPost(article)
    var media = cache.media_urls && cache.media_urls.length ? cache.media_urls.slice() : []
    if (ogImage) media.push(ogImage)
    if (ogVideo) media.push(ogVideo)

    var post = {
      id: cache.id || code || '',
      shortcode: code || cache.shortcode || '',
      author_id: cache.author_id || '',
      author_username: author || '',
      content: text || '',
      media_urls: this._unique(media),
      likes: cache.likes != null ? cache.likes : this._metricFromMeta(ogDesc, 'likes'),
      comments: cache.comments != null ? cache.comments : this._metricFromMeta(ogDesc, 'comments'),
      views: cache.views != null ? cache.views : null,
      published_at: cache.published_at || '',
      url: code ? 'https://www.instagram.com/' + this._postTypeFromPath() + '/' + code + '/' : location.href,
      source: cache.source || 'dom_post',
    }
    if (!post.id && !post.content && !post.media_urls.length) return null
    return post
  },

  _extractCaption: function (article, metaDesc) {
    if (article) {
      var h1 = article.querySelector('h1')
      if (h1 && this._text(h1)) return this._text(h1)
      var candidates = Array.prototype.slice.call(article.querySelectorAll('span, div')).map(this._text.bind(this))
        .filter(function (s) {
          return s && s.length > 20 &&
            !/\b(likes|comments|me gusta|comentarios|follow|seguir)\b/i.test(s)
        })
      if (candidates.length) return candidates[0]
    }
    if (metaDesc) {
      var qm = metaDesc.match(/:\s*"([^"]{1,1000})"/)
      if (qm) return qm[1].trim()
    }
    return ''
  },

  _extractAuthorFromPost: function (article) {
    if (!article) return ''
    var links = article.querySelectorAll('a[href^="/"]')
    for (var i = 0; i < links.length; i++) {
      var u = this._usernameFromHref(links[i].getAttribute('href') || '')
      if (u) return u
    }
    return ''
  },

  _metricFromMeta: function (text, metric) {
    text = text || ''
    var rx = metric === 'likes'
      ? /([\d.,]+[KMBkmb]?)\s+(?:likes|me gusta)/i
      : /([\d.,]+[KMBkmb]?)\s+(?:comments|comentarios)/i
    var m = text.match(rx)
    return m ? this._parseCount(m[1]) : null
  },

  // --------------------------------------------------------------------------
  // Connection extraction
  // --------------------------------------------------------------------------

  _connectionModalInfo: function () {
    var modals = Array.prototype.slice.call(document.querySelectorAll('div[role="dialog"], section[role="dialog"]'))
    for (var i = 0; i < modals.length; i++) {
      var modal = modals[i]
      var links = Array.prototype.slice.call(modal.querySelectorAll('a[href^="/"]')).filter(function (a) {
        return !!NarsilModules.instagram._usernameFromHref(a.getAttribute('href') || '')
      })
      if (!links.length) continue
      var text = this._text(modal).toLowerCase()
      var role = /followers|seguidores/.test(text) ? 'followers'
        : /following|seguidos|siguiendo/.test(text) ? 'following'
        : 'connections'
      return { modal: modal, container: this._findScrollableContainer(modal), role: role }
    }
    return { modal: null, container: null, role: '' }
  },

  _findScrollableContainer: function (modal) {
    if (!modal) return null
    var candidates = Array.prototype.slice.call(modal.querySelectorAll('div, section, ul'))
      .filter(function (n) {
        return n.querySelectorAll('a[href^="/"]').length >= 2 &&
          (n.scrollHeight > n.clientHeight + 20 || n.getAttribute('role') === 'dialog')
      })
    if (!candidates.length) return modal
    candidates.sort(function (a, b) {
      return b.querySelectorAll('a[href^="/"]').length - a.querySelectorAll('a[href^="/"]').length
    })
    return candidates[0]
  },

  _scrollConnectionsLimited: function (container, maxIter) {
    maxIter = maxIter || 12
    return new Promise(function (resolve) {
      var previousCount = 0, stable = 0, iter = 0
      function step() {
        var links = container.querySelectorAll('a[href^="/"]').length
        if (links === previousCount) stable++
        else { stable = 0; previousCount = links }
        if (container.scrollTo) container.scrollTo(0, container.scrollHeight)
        else container.scrollTop = container.scrollHeight
        iter++
        if (iter >= maxIter || stable >= 3 || links >= 150) return resolve()
        setTimeout(step, 900)
      }
      step()
    })
  },

  _extractConnectionRows: function (info) {
    info = info || this._connectionModalInfo()
    var root = info.container || info.modal
    if (!root) return []
    var rows = []
    var seen = {}
    var self = this
    Array.prototype.forEach.call(root.querySelectorAll('a[href^="/"]'), function (a) {
      var username = self._usernameFromHref(a.getAttribute('href') || '')
      if (!username || seen[username.toLowerCase()]) return
      seen[username.toLowerCase()] = true
      var rowEl = self._rowForAnchor(a)
      var cache = self._lookupProfile(username)
      var parsed = self._parseConnectionText(rowEl, username)
      var avatar = rowEl ? rowEl.querySelector('img[src]') : null
      rows.push({
        'ID': cache.id || NarsilExport.missing('id no capturado'),
        'Usuario': username,
        'Nombre': cache.display_name || parsed.display_name || NarsilExport.missing(),
        'Perfil': 'https://www.instagram.com/' + username + '/',
        'Avatar': cache.avatar_url || (avatar ? (avatar.currentSrc || avatar.src || avatar.getAttribute('src')) : '') || NarsilExport.missing(),
        'Verificado': cache.verified == null ? NarsilExport.missing() : String(cache.verified),
        'Privado': cache.is_private == null ? NarsilExport.missing() : String(cache.is_private),
      })
    })
    return rows
  },

  _rowForAnchor: function (a) {
    var node = a
    for (var i = 0; node && i < 6; i++) {
      if (node.querySelectorAll && node.querySelectorAll('a[href^="/"]').length >= 1 && node.querySelector('img[src]')) return node
      node = node.parentElement
    }
    return a.parentElement || a
  },

  _parseConnectionText: function (rowEl, username) {
    var out = { display_name: '' }
    if (!rowEl) return out
    var lines = this._text(rowEl).split(/\n/).map(function (s) { return s.trim() }).filter(Boolean)
    var blocked = /^(follow|following|seguir|siguiendo|eliminar|remove|message|mensaje)$/i
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (!line || blocked.test(line)) continue
      if (line === username || line === '@' + username) continue
      if (!out.display_name) out.display_name = line
    }
    return out
  },

  // --------------------------------------------------------------------------
  // Normalizers and cache
  // --------------------------------------------------------------------------

  _walkData: function (obj, depth, seen) {
    if (!obj || typeof obj !== 'object' || depth > 7) return
    depth = depth || 0
    seen = seen || []
    if (seen.indexOf(obj) >= 0) return
    seen.push(obj)

    if (obj.username && (obj.pk || obj.id || obj.full_name || obj.profile_pic_url || obj.biography)) {
      this._cacheUser(obj, 'embedded_json')
    }
    if ((obj.shortcode || obj.code || obj.pk || obj.id) &&
        (obj.caption || obj.edge_media_to_caption || obj.image_versions2 || obj.owner)) {
      this._cachePost(obj, 'embedded_json')
    }

    if (Array.isArray(obj.items)) this._cacheMediaItems(obj.items, 'embedded_items')

    var keys = Object.keys(obj)
    for (var i = 0; i < keys.length && i < 160; i++) {
      var v = obj[keys[i]]
      if (v && typeof v === 'object') this._walkData(v, depth + 1, seen)
    }
  },

  _cacheMediaItems: function (items, source) {
    var self = this
    ;(items || []).forEach(function (item) { self._cachePost(item, source) })
  },

  _cacheUser: function (u, source) {
    var user = this._normaliseUser(u)
    if (!user.username && !user.id) return {}
    user.id_source = user.id ? source : ''
    this._rememberProfile(user)
    this._add(this._profileToSchema(user))
    return user
  },

  _normaliseUser: function (u) {
    u = u || {}
    var edgeFollowers = u.edge_followed_by || {}
    var edgeFollowing = u.edge_follow || {}
    var edgePosts = u.edge_owner_to_timeline_media || {}
    var bioLinks = Array.isArray(u.bio_links) ? u.bio_links : []
    var externalUrl = u.external_url || ''
    if (!externalUrl && bioLinks.length) externalUrl = bioLinks[0].url || bioLinks[0].lynx_url || ''
    return {
      id: this._stringId(u.pk || u.pk_id || u.id || u.fbid || u.profile_id),
      username: u.username || u.user_name || '',
      display_name: u.full_name || u.name || '',
      bio: u.biography || u.bio || '',
      avatar_url: u.profile_pic_url_hd || u.profile_pic_url || '',
      followers: this._numberOrNull(u.follower_count != null ? u.follower_count : edgeFollowers.count),
      following: this._numberOrNull(u.following_count != null ? u.following_count : edgeFollowing.count),
      posts: this._numberOrNull(u.media_count != null ? u.media_count : edgePosts.count),
      verified: u.is_verified != null ? !!u.is_verified : null,
      is_private: u.is_private != null ? !!u.is_private : null,
      category: u.category || u.category_name || u.business_category_name || '',
      external_url: externalUrl,
      profile_url: u.username ? 'https://www.instagram.com/' + u.username + '/' : '',
      source: 'normalised_user',
    }
  },

  _rememberProfile: function (user) {
    if (!user) return
    var keys = []
    if (user.username) keys.push('u:' + user.username.toLowerCase())
    if (user.id) keys.push('id:' + user.id)
    for (var i = 0; i < keys.length; i++) {
      var prev = this._profileCache[keys[i]] || {}
      this._profileCache[keys[i]] = {
        id: user.id || prev.id || '',
        id_source: user.id_source || prev.id_source || '',
        username: user.username || prev.username || '',
        display_name: user.display_name || prev.display_name || '',
        bio: user.bio || prev.bio || '',
        avatar_url: user.avatar_url || prev.avatar_url || '',
        followers: user.followers != null ? user.followers : prev.followers,
        following: user.following != null ? user.following : prev.following,
        posts: user.posts != null ? user.posts : prev.posts,
        verified: user.verified != null ? user.verified : prev.verified,
        is_private: user.is_private != null ? user.is_private : prev.is_private,
        category: user.category || prev.category || '',
        external_url: user.external_url || prev.external_url || '',
      }
    }
  },

  _lookupProfile: function (usernameOrId) {
    if (!usernameOrId) return {}
    var key = String(usernameOrId)
    return this._profileCache['u:' + key.replace(/^@/, '').toLowerCase()] ||
      this._profileCache['id:' + key] || {}
  },

  _cachePost: function (item, source) {
    var post = this._normalisePost(item, source)
    if (!post.id && !post.shortcode) return {}
    var keys = []
    if (post.shortcode) keys.push('code:' + post.shortcode)
    if (post.id) keys.push('id:' + post.id)
    for (var i = 0; i < keys.length; i++) {
      var prev = this._postCache[keys[i]] || {}
      this._postCache[keys[i]] = Object.assign({}, prev, post)
    }
    this._add(this._postToSchema(post))
    return post
  },

  _normalisePost: function (item, source) {
    item = item || {}
    var owner = item.user || item.owner || {}
    if (owner && owner.username) this._cacheUser(owner, source + '_author')
    var caption = ''
    if (item.caption && typeof item.caption === 'object') caption = item.caption.text || ''
    else if (typeof item.caption === 'string') caption = item.caption
    var edges = item.edge_media_to_caption && item.edge_media_to_caption.edges
    if (!caption && edges && edges[0] && edges[0].node) caption = edges[0].node.text || ''

    var media = []
    if (item.image_versions2 && item.image_versions2.candidates && item.image_versions2.candidates[0]) {
      media.push(item.image_versions2.candidates[0].url)
    }
    if (item.display_url) media.push(item.display_url)
    if (item.video_url) media.push(item.video_url)
    if (Array.isArray(item.carousel_media)) {
      item.carousel_media.forEach(function (m) {
        if (m.image_versions2 && m.image_versions2.candidates && m.image_versions2.candidates[0]) {
          media.push(m.image_versions2.candidates[0].url)
        }
        if (m.video_url) media.push(m.video_url)
      })
    }

    return {
      id: this._stringId(item.pk || item.id || item.media_id),
      shortcode: item.code || item.shortcode || '',
      author_id: this._stringId(owner.pk || owner.id),
      author_username: owner.username || '',
      content: caption || '',
      media_urls: this._unique(media),
      likes: this._numberOrNull(item.like_count != null ? item.like_count : item.edge_media_preview_like && item.edge_media_preview_like.count),
      comments: this._numberOrNull(item.comment_count != null ? item.comment_count : item.edge_media_to_comment && item.edge_media_to_comment.count),
      views: this._numberOrNull(item.view_count || item.play_count || item.video_view_count),
      published_at: item.taken_at_timestamp ? new Date(item.taken_at_timestamp * 1000).toISOString()
        : item.taken_at ? new Date(item.taken_at * 1000).toISOString() : '',
      url: (item.code || item.shortcode) ? 'https://www.instagram.com/p/' + (item.code || item.shortcode) + '/' : '',
      source: source || 'passive',
    }
  },

  _lookupPost: function (codeOrId) {
    if (!codeOrId) return {}
    return this._postCache['code:' + codeOrId] || this._postCache['id:' + codeOrId] || {}
  },

  _extractUserFromScripts: function (doc, username) {
    if (!username) return {}
    var lower = username.toLowerCase()
    var scripts = doc.querySelectorAll('script')
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || ''
      if (!text || text.toLowerCase().indexOf(lower) < 0) continue
      var idx = text.toLowerCase().indexOf(lower)
      var slice = text.slice(Math.max(0, idx - 8000), Math.min(text.length, idx + 8000))
      var user = {
        id: this._matchJsonValue(slice, ['id', 'pk', 'pk_id']),
        username: this._matchJsonValue(slice, ['username']) || username,
        display_name: this._matchJsonValue(slice, ['full_name', 'name']),
        bio: this._matchJsonValue(slice, ['biography', 'bio']),
        avatar_url: this._matchJsonValue(slice, ['profile_pic_url_hd', 'profile_pic_url']),
        external_url: this._matchJsonValue(slice, ['external_url']),
        verified: this._matchJsonBool(slice, ['is_verified']),
        is_private: this._matchJsonBool(slice, ['is_private']),
        category: this._matchJsonValue(slice, ['category_name', 'business_category_name', 'category']),
        id_source: 'embedded_script',
      }
      if (user.id || user.bio || user.display_name) return user
    }
    return {}
  },

  // --------------------------------------------------------------------------
  // Schema and text output
  // --------------------------------------------------------------------------

  _profileToSchema: function (p) {
    return NarsilSchema.profile('instagram', {
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      bio: p.bio,
      avatar_url: p.avatar_url,
      followers: p.followers,
      following: p.following,
      posts: p.posts,
      verified: p.verified,
      url: p.profile_url || (p.username ? 'https://www.instagram.com/' + p.username + '/' : null),
      network_specific: {
        source: p.source || 'instagram_profile',
        profile_id_source: p.id_source,
        is_private: p.is_private,
        category: p.category,
        external_url: p.external_url,
        warnings: p.warnings || [],
      },
    })
  },

  _postToSchema: function (p) {
    return NarsilSchema.post('instagram', {
      id: p.id || p.shortcode,
      author_id: p.author_id,
      author_username: p.author_username,
      content: p.content,
      media_urls: p.media_urls,
      likes: p.likes,
      comments: p.comments,
      views: p.views,
      published_at: p.published_at,
      url: p.url,
      network_specific: {
        source: p.source,
        shortcode: p.shortcode,
      },
    })
  },

  _profileToText: function (p) {
    var lines = ['Instagram profile report', 'Captured: ' + new Date().toISOString(), 'URL: ' + (p.profile_url || location.href), '']
    function add(label, value) { if (value !== null && value !== undefined && value !== '') lines.push(label + ': ' + value) }
    add('Profile ID', p.id)
    add('Profile ID source', p.id_source)
    add('Username', p.username ? '@' + p.username : '')
    add('Display name', p.display_name)
    add('Bio', p.bio)
    add('External URL', p.external_url)
    add('Followers', p.followers)
    add('Following', p.following)
    add('Posts', p.posts)
    add('Verified', p.verified === null ? '' : String(p.verified))
    add('Private', p.is_private === null ? '' : String(p.is_private))
    add('Category', p.category)
    add('Avatar URL', p.avatar_url)
    if (p.warnings && p.warnings.length) add('Warnings', p.warnings.join(', '))
    return lines.join('\n')
  },

  _postToText: function (p) {
    var lines = ['Instagram post report', 'Captured: ' + new Date().toISOString(), '']
    function add(label, value) { if (value !== null && value !== undefined && value !== '') lines.push(label + ': ' + value) }
    add('Post ID', p.id)
    add('Shortcode', p.shortcode)
    add('URL', p.url)
    add('Author ID', p.author_id)
    add('Author', p.author_username ? '@' + p.author_username : '')
    add('Published at', p.published_at)
    add('Text', p.content)
    add('Likes', p.likes)
    add('Comments', p.comments)
    add('Views', p.views)
    if (p.media_urls && p.media_urls.length) add('Media URLs', p.media_urls.join(' | '))
    return lines.join('\n')
  },

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  _add: function (item) {
    if (!item) return
    var id = item.id || item.url || item.username || item.display_name || JSON.stringify(item).slice(0, 120)
    var role = item.role || (item.network_specific && item.network_specific.role) || ''
    var key = item._type + ':' + role + ':' + id
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
  },

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

  _requestPageData: function (delayMs) {
    return new Promise(function (resolve) {
      try { window.postMessage({ __narsil_cmd: 'EXTRACT_PAGE_DATA' }, '*') } catch (_) {}
      setTimeout(resolve, delayMs || 300)
    })
  },

  _currentProfileUsername: function () {
    var m = String(location.pathname || '').match(/^\/([A-Za-z0-9._]{1,30})\/?$/)
    return m && !this._isReservedUsername(m[1]) ? m[1] : ''
  },

  _currentPostCode: function () {
    var m = String(location.pathname || '').match(/^\/(?:p|reel|tv)\/([^/?#]+)/)
    return m ? m[1] : ''
  },

  _postTypeFromPath: function () {
    var m = String(location.pathname || '').match(/^\/(p|reel|tv)\//)
    return m ? m[1] : 'p'
  },

  _usernameFromHref: function (href) {
    var m = String(href || '').match(/^\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/)
    if (!m || this._isReservedUsername(m[1])) return ''
    return m[1]
  },

  _isSensitivePath: function (p) {
    return /^\/direct(?:\/|$)/.test(p) ||
      /^\/accounts(?:\/|$)/.test(p) ||
      /^\/emails(?:\/|$)/.test(p) ||
      /^\/challenge(?:\/|$)/.test(p)
  },

  _isReservedPath: function (p) {
    return this._isReservedUsername(String(p || '').replace(/^\/|\/$/g, '').split('/')[0])
  },

  _isReservedUsername: function (u) {
    return /^(accounts|api|challenge|direct|explore|developer|about|legal|privacy|terms|reels|stories|p|reel|tv|web|graphql|oauth|emails|sessionlogin|onetap|create|notifications)$/i.test(u || '')
  },

  _text: function (el) {
    if (!el) return ''
    return String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  },

  _meta: function (doc, attr, value) {
    var el = doc.querySelector('meta[' + attr + '="' + value + '"]')
    return el ? (el.getAttribute('content') || '') : ''
  },

  _stringId: function (value) {
    if (value === null || value === undefined || value === '') return ''
    return String(value)
  },

  _numberOrNull: function (value) {
    if (value === null || value === undefined || value === '') return null
    var n = Number(value)
    return isFinite(n) ? n : null
  },

  _parseCount: function (raw) {
    raw = String(raw || '').replace(/\u00a0/g, ' ').trim()
    var m = raw.match(/([\d.,]+)\s*([KMBkmb])?/)
    if (!m) return null
    var n = parseFloat(m[1].replace(/,/g, '.'))
    if (!isFinite(n)) return null
    var suffix = (m[2] || '').toLowerCase()
    if (suffix === 'k') n *= 1000
    else if (suffix === 'm') n *= 1000000
    else if (suffix === 'b') n *= 1000000000
    return Math.round(n)
  },

  _matchJsonValue: function (text, keys) {
    for (var i = 0; i < keys.length; i++) {
      var rx = new RegExp('"' + keys[i] + '"\\s*:\\s*"((?:\\\\.|[^"\\\\]){0,1200})"', 'i')
      var m = text.match(rx)
      if (m) return this._decodeJsonString(m[1])
      var nrx = new RegExp('"' + keys[i] + '"\\s*:\\s*(\\d{2,30})', 'i')
      var nm = text.match(nrx)
      if (nm) return nm[1]
    }
    return ''
  },

  _matchJsonBool: function (text, keys) {
    for (var i = 0; i < keys.length; i++) {
      var rx = new RegExp('"' + keys[i] + '"\\s*:\\s*(true|false)', 'i')
      var m = text.match(rx)
      if (m) return m[1] === 'true'
    }
    return null
  },

  _decodeJsonString: function (s) {
    if (!s) return ''
    return String(s)
      .replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)) })
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .trim()
  },

  _unique: function (items) {
    var out = [], seen = {}
    ;(items || []).forEach(function (item) {
      if (!item || seen[item]) return
      seen[item] = true
      out.push(item)
    })
    return out
  },

  _initObserver: function () {
    var self = this
    var pending = null
    var observer = new MutationObserver(function () {
      clearTimeout(pending)
      pending = setTimeout(function () {
        var wasOpen = self._modalOpen
        self._modalOpen = !!self._connectionModalInfo().modal
        if (self._modalOpen !== wasOpen) {
          if (!self._modalOpen) self._scraping = false
          NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
        }
      }, 200)
    })
    if (document.body) observer.observe(document.body, { childList: true, subtree: true })
  },
}

if (NarsilDetector.current() === 'instagram') {
  NarsilModules.instagram._initObserver()
}
