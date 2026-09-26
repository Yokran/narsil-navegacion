// NARSIL Intel Collector - modules/twitter.js
// X/Twitter collector. Restored from the original passive GraphQL-aware module
// and extended with TikTok-style active actions for DOM profile, tweet and
// followers/following extraction.
'use strict'

NarsilModules.twitter = {
  network:       'twitter',
  collected:     [],
  _seen:         {},
  _scraping:     false,
  _profileCache: {},

  getPageType: function () {
    var p = location.pathname || '/'
    if (this._isSensitivePath(p)) return 'sensitive'
    if (/^\/[^/]+\/status\/\d+/.test(p)) return 'tweet'
    if (/^\/[^/]+\/(?:followers|following|verified_followers|followers_you_follow)\/?$/.test(p)) return 'connections'
    if (/^\/(?:home|explore|search)(?:\/|$)/.test(p)) return 'feed'
    if (/^\/[A-Za-z0-9_]{1,15}(?:\/(?:with_replies|media|highlights|articles))?\/?$/.test(p)) return 'profile'
    return 'other'
  },

  getActions: function () {
    var type = this.getPageType()
    var a = []
    if (type === 'profile') {
      a.push({ id: 'profile', label: '⊕ Reporte del perfil (TXT)' })
    } else if (type === 'tweet') {
      a.push({ id: 'tweet', label: '⊕ Datos del tweet (TXT)' })
      a.push({ id: 'author_profile', label: '⊕ Perfil del autor visible' })
    } else if (type === 'connections') {
      a.push({
        id: 'connections',
        label: this._scraping ? '⏳ Scraping conexiones...' : '⊕ Scraping conexiones → XLSX',
      })
    } else if (type === 'sensitive') {
      a.push({ id: 'blocked', label: 'Vista sensible: no extraer' })
    }
    return a
  },

  runAction: function (id) {
    switch (id) {
      case 'profile':        this._actionProfile(); break
      case 'tweet':          this._actionTweet(); break
      case 'author_profile': this._actionAuthorProfile(); break
      case 'connections':    this._actionConnections(); break
      case 'blocked':
        NarsilPanel && NarsilPanel.log('X: vista sensible/no soportada. No se extrae contenido.', 'err')
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
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // ==========================================================================
  // Active actions
  // ==========================================================================

  _actionProfile: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('X: resolviendo IDs del perfil...')
    this._requestNetworkReplay(550).then(function () { self._actionProfileNow() })
  },

  _actionProfileNow: function () {
    var profile = this._extractProfileDOM(document)
    if (!profile.username) {
      NarsilPanel && NarsilPanel.log('X: navega a un perfil primero.', 'err')
      return
    }

    this._add(NarsilSchema.profile('twitter', {
      id:           profile.id,
      username:     profile.username,
      display_name: profile.display_name,
      bio:          profile.bio,
      avatar_url:   profile.avatar_url,
      followers:    this._parseVisibleNumber(profile.followers_text),
      following:    this._parseVisibleNumber(profile.following_text),
      posts:        this._parseVisibleNumber(profile.posts_text),
      verified:     profile.verified,
      url:          profile.profile_url,
      location:     profile.location,
      network_specific: {
        source:                'dom_profile',
        profile_id_source:     profile.id_source,
        external_url:          profile.external_url,
        external_url_text:     profile.external_url_text,
        join_date_text:        profile.join_date_text,
        professional_category: profile.professional_category,
        banner_url:            profile.banner_url,
        followers_text:        profile.followers_text,
        following_text:        profile.following_text,
        verified_followers_text: profile.verified_followers_text,
        warnings:              profile.warnings,
      },
    }))

    this._sendDownload(
      (profile.username || 'x_profile') + '_x_profile.txt',
      this._profileToText(profile),
      'text/plain;charset=utf-8'
    )
    NarsilPanel && NarsilPanel.log('X: reporte de @' + profile.username + ' descargado.', 'ok')
  },

  _actionTweet: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('X: resolviendo IDs del tweet...')
    this._requestNetworkReplay(550).then(function () { self._actionTweetNow() })
  },

  _actionTweetNow: function () {
    var article = document.querySelector('article[data-testid="tweet"]')
    if (!article) {
      NarsilPanel && NarsilPanel.log('X: navega a un tweet o espera a que cargue.', 'err')
      return
    }
    var tweet = this._extractTweetArticle(article)
    if (!tweet || !tweet.id) {
      NarsilPanel && NarsilPanel.log('X: no se pudo extraer el tweet visible.', 'err')
      return
    }
    this._add(this._tweetToSchema(tweet))
    this._sendDownload(
      tweet.id + '_x_tweet.txt',
      this._tweetToText(tweet),
      'text/plain;charset=utf-8'
    )
    NarsilPanel && NarsilPanel.log('X: tweet ' + tweet.id + ' descargado.', 'ok')
  },

  _actionAuthorProfile: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('X: resolviendo ID del autor...')
    this._requestNetworkReplay(550).then(function () { self._actionAuthorProfileNow() })
  },

  _actionAuthorProfileNow: function () {
    var article = document.querySelector('article[data-testid="tweet"]')
    if (!article) {
      NarsilPanel && NarsilPanel.log('X: no se encontró tweet visible.', 'err')
      return
    }
    var userBlock = article.querySelector('[data-testid="User-Name"]')
    var parsed = this._parseUserNameBlock(userBlock || article)
    if (!parsed.username) {
      NarsilPanel && NarsilPanel.log('X: no se pudo identificar autor visible.', 'err')
      return
    }
    var cache = this._lookupProfileCache(parsed.username)
    var idInfo = this._extractIdFromNode(article)
    if (!idInfo.id && cache.id) idInfo = { id: cache.id, source: 'passive_graphql_cache' }
    if (!idInfo.id) {
      var reactAuthor = this._extractUserFromReactNode(userBlock || article, parsed.username)
      if (reactAuthor.id) {
        idInfo = { id: reactAuthor.id, source: 'react_props' }
        this._rememberProfile(reactAuthor)
      }
    }
    var avatar = article.querySelector('[data-testid^="UserAvatar-Container"] img[src], img[src*="profile_images"]')
    var profile = {
      id: idInfo.id || null,
      id_source: idInfo.source || null,
      username: parsed.username,
      display_name: parsed.displayName || cache.display_name || '',
      bio: cache.bio || '',
      location: '',
      external_url: '',
      external_url_text: '',
      join_date_text: '',
      professional_category: '',
      verified: userBlock ? !!userBlock.querySelector('[data-testid="icon-verified"]') : null,
      avatar_url: avatar ? (avatar.currentSrc || avatar.src || avatar.getAttribute('src')) : '',
      banner_url: '',
      followers_text: '',
      following_text: '',
      verified_followers_text: '',
      posts_text: '',
      profile_url: 'https://x.com/' + parsed.username,
      warnings: idInfo.id ? ['partial_author_profile_from_visible_tweet'] : ['partial_author_profile_from_visible_tweet', 'profile_id_not_found'],
    }
    this._add(NarsilSchema.profile('twitter', {
      id: profile.id, username: profile.username, display_name: profile.display_name,
      avatar_url: profile.avatar_url, verified: profile.verified, url: profile.profile_url,
      bio: profile.bio,
      network_specific: { source: 'dom_tweet_author', profile_id_source: profile.id_source, warnings: profile.warnings },
    }))
    this._sendDownload(profile.username + '_x_author_profile.txt', this._profileToText(profile), 'text/plain;charset=utf-8')
    NarsilPanel && NarsilPanel.log('X: perfil visible del autor @' + profile.username + ' descargado.', 'ok')
  },

  _actionConnections: function () {
    var self = this
    if (this._scraping) return

    var info = this._connectionInfo()
    if (!info.type || !info.owner) {
      NarsilPanel && NarsilPanel.log('X: abre /followers o /following de un perfil primero.', 'err')
      return
    }

    this._scraping = true
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    NarsilPanel && NarsilPanel.log('X: scraping limitado de conexiones iniciado...')

    this._scrollConnectionsLimited(8).then(function () {
      NarsilPanel && NarsilPanel.log('X: resolviendo IDs de conexiones...')
      return self._requestNetworkReplay(650)
    }).then(function () {
      var rows = self._extractConnections(info)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('X: no se encontraron conexiones visibles.', 'err')
        self._scraping = false
        NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
        return
      }

      rows.forEach(function (row) {
        self._add(NarsilSchema.contact('twitter', {
          id: row.ID && !row.ID.__narsilMissing ? row.ID : null,
          username: row.Username && !row.Username.__narsilMissing ? row.Username : null,
          display_name: row['Display Name'] && !row['Display Name'].__narsilMissing ? row['Display Name'] : null,
          role: row.Relationship,
          avatar_url: row['Avatar URL'] && !row['Avatar URL'].__narsilMissing ? row['Avatar URL'] : null,
          network_specific: {
            source:         'dom_connections',
            profile_id_source: row['ID Source'],
            source_profile: row['Source Profile'],
            source_url:     row['Source URL'],
            profile_url:    row['Profile URL'],
            bio:            row.Bio,
            verified:       row.Verified,
          },
        }))
      })

      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      var bytes = NarsilExport.toXLSX(rows)
      var b64 = NarsilExport.uint8ToBase64(bytes)
      self._sendDownloadBinary(
        'x_' + info.owner + '_' + info.type + '_' + ts + '.xlsx',
        b64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      NarsilPanel && NarsilPanel.log('X: ' + rows.length + ' conexiones exportadas.', 'ok')
      self._scraping = false
      NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('X: error en conexiones - ' + e.message, 'err')
      self._scraping = false
      NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
    })
  },

  // ==========================================================================
  // DOM extraction
  // ==========================================================================

  _extractProfileDOM: function (doc) {
    doc = doc || document
    var userName = doc.querySelector('[data-testid="UserName"]')
    var parsed = this._parseUserNameBlock(userName)
    var username = parsed.username || this._currentProfileHandle()
    var cache = this._lookupProfileCache(username)
    var idInfo = this._extractProfileId(doc, username)

    var bio = doc.querySelector('[data-testid="UserDescription"]')
    var loc = doc.querySelector('[data-testid="UserLocation"]')
    var urlLink = doc.querySelector('[data-testid="UserUrl"] a[href]')
    var join = doc.querySelector('[data-testid="UserJoinDate"]')
    var category = doc.querySelector('[data-testid="UserProfessionalCategory"]')
    var avatar = doc.querySelector('[data-testid^="UserAvatar-Container"] img[src], img[src*="profile_images"]')

    var counts = this._extractVisibleCounts(doc, username)
    var warnings = []
    if (!idInfo.id && cache.id) {
      idInfo = { id: cache.id, source: 'passive_graphql_cache' }
    }
    if (!idInfo.id) {
      var reactProfile = this._extractUserFromReactNode(userName || doc.querySelector('main') || doc.body, username)
      if (reactProfile.id) {
        idInfo = { id: reactProfile.id, source: 'react_props' }
        this._rememberProfile(reactProfile)
      }
    }
    if (!idInfo.id) warnings.push('profile_id_not_found')

    return {
      id: idInfo.id || null,
      id_source: idInfo.source || null,
      username: username || null,
      display_name: parsed.displayName || cache.display_name || null,
      bio: this._text(bio) || cache.bio || '',
      location: this._text(loc),
      external_url: urlLink ? this._absoluteUrl(urlLink.getAttribute('href')) : '',
      external_url_text: urlLink ? this._text(urlLink) : '',
      join_date_text: this._text(join),
      professional_category: this._text(category),
      verified: userName ? !!userName.querySelector('[data-testid="icon-verified"]') : null,
      avatar_url: avatar ? (avatar.currentSrc || avatar.src || avatar.getAttribute('src')) : (cache.avatar_url || ''),
      banner_url: this._extractBannerUrl(doc),
      followers_text: counts.followers || '',
      following_text: counts.following || '',
      verified_followers_text: counts.verified_followers || '',
      posts_text: counts.posts || '',
      profile_url: username ? 'https://x.com/' + username : location.href,
      warnings: warnings,
    }
  },

  _extractTweetArticle: function (article) {
    if (!article) return null
    var userBlock = article.querySelector('[data-testid="User-Name"]')
    var parsed = this._parseUserNameBlock(userBlock || article)
    var textEl = article.querySelector('[data-testid="tweetText"]')
    var timeEl = article.querySelector('time[datetime]')
    var status = this._statusFromArticle(article)
    var media = this._extractTweetMedia(article)
    var links = this._extractTweetLinks(article)
    var authorCache = this._lookupProfileCache(parsed.username || this._handleFromTweetArticle(article))
    var authorIdInfo = this._extractIdFromNode(userBlock || article)
    if (!authorIdInfo.id && authorCache.id) authorIdInfo = { id: authorCache.id, source: 'passive_graphql_cache' }
    if (!authorIdInfo.id) {
      var reactTweetAuthor = this._extractUserFromReactNode(userBlock || article, parsed.username || this._handleFromTweetArticle(article))
      if (reactTweetAuthor.id) {
        authorIdInfo = { id: reactTweetAuthor.id, source: 'react_props' }
        this._rememberProfile(reactTweetAuthor)
      }
    }

    var tweet = {
      id: status.id || '',
      author_id: authorIdInfo.id || '',
      author_id_source: authorIdInfo.source || '',
      author_username: parsed.username || this._handleFromTweetArticle(article) || '',
      author_display_name: parsed.displayName || authorCache.display_name || '',
      content: this._text(textEl),
      media_urls: media.map(function (m) { return m.url || m.poster_url }).filter(Boolean),
      likes: this._extractMetric(article, 'like'),
      comments: this._extractMetric(article, 'reply'),
      shares: this._extractMetric(article, 'retweet'),
      bookmarks: this._extractMetric(article, 'bookmark'),
      views: this._extractViews(article),
      published_at: timeEl ? timeEl.getAttribute('datetime') || '' : '',
      published_text: timeEl ? this._text(timeEl) : '',
      url: status.url || '',
      mentions: this._extractMentions(article, textEl),
      hashtags: this._extractHashtags(article, textEl),
      cashtags: this._extractCashtags(article, textEl),
      external_links: links,
      media: media,
      relationship_hints: this._extractRelationshipHints(article),
      source: 'dom_article',
    }

    if (!tweet.id && !tweet.content && !tweet.media_urls.length) return null
    return tweet
  },

  _extractConnections: function (info) {
    info = info || this._connectionInfo()
    var cells = Array.prototype.slice.call(document.querySelectorAll('[data-testid="UserCell"]'))
    var rows = []
    var seen = {}
    var self = this
    cells.forEach(function (cell) {
      var user = self._extractUserCell(cell)
      if (!user.username) return
      var key = info.type + ':' + user.username.toLowerCase()
      if (seen[key]) return
      seen[key] = true
      rows.push({
        'ID': user.id || NarsilExport.missing(),
        'ID Source': user.id_source || NarsilExport.missing(),
        'Username': user.username,
        'Display Name': user.display_name || NarsilExport.missing(),
        'Relationship': info.type,
        'Profile URL': user.profile_url || ('https://x.com/' + user.username),
        'Bio': user.bio || NarsilExport.missing(),
        'Avatar URL': user.avatar_url || NarsilExport.missing(),
        'Verified': user.verified === null ? NarsilExport.missing() : String(user.verified),
        'Source Profile': info.owner,
        'Source URL': location.href,
        'Captured At': new Date().toISOString(),
      })
    })
    return rows
  },

  _extractUserCell: function (cell) {
    var userBlock = cell.querySelector('[data-testid="User-Name"], [data-testid="UserName"]') || cell
    var parsed = this._parseUserNameBlock(userBlock)
    var username = parsed.username || this._handleFromTweetArticle(cell)
    var profileUrl = username ? 'https://x.com/' + username : ''
    var idInfo = this._extractIdFromNode(cell)
    var cache = this._lookupProfileCache(username)
    if (!idInfo.id && cache.id) idInfo = { id: cache.id, source: 'passive_graphql_cache' }
    if (!idInfo.id) {
      var reactUser = this._extractUserFromReactNode(cell, username)
      if (reactUser.id) {
        idInfo = { id: reactUser.id, source: 'react_props' }
        this._rememberProfile(reactUser)
      }
    }
    var avatar = cell.querySelector('img[src*="profile_images"], [data-testid^="UserAvatar-Container"] img[src]')
    return {
      id: idInfo.id || '',
      id_source: idInfo.source || '',
      username: username || '',
      display_name: parsed.displayName || cache.display_name || '',
      bio: this._extractUserCellBio(cell, parsed) || cache.bio || '',
      avatar_url: avatar ? (avatar.currentSrc || avatar.src || avatar.getAttribute('src')) : (cache.avatar_url || ''),
      profile_url: profileUrl,
      verified: !!cell.querySelector('[data-testid="icon-verified"]'),
    }
  },

  // ==========================================================================
  // Passive GraphQL parser restored from previous module and made deeper.
  // ==========================================================================

  _parseUser: function (u) {
    if (!u) return
    var legacy = u.legacy || u
    var norm = this._normaliseUserResult(u)
    var username = norm.username
    var id = norm.id
    var avatarUrl = norm.avatar_url
    if (username) this._rememberProfile(norm)
    this._add(NarsilSchema.profile('twitter', {
      id:           id ? String(id) : '',
      username:     username,
      display_name: norm.display_name || legacy.name,
      bio:          norm.bio || legacy.description,
      avatar_url:   avatarUrl,
      followers:    legacy.followers_count,
      following:    legacy.friends_count,
      posts:        legacy.statuses_count,
      verified:     !!(legacy.verified || u.is_blue_verified),
      url:          username ? 'https://x.com/' + username : null,
      location:     legacy.location,
      network_specific: {
        source:           'passive_graphql',
        created_at:       legacy.created_at,
        listed_count:     legacy.listed_count,
        media_count:      legacy.media_count,
        is_blue_verified: !!u.is_blue_verified,
      },
    }))
  },

  _parseTweet: function (tweet) {
    if (!tweet) return
    if (tweet.tweet && tweet.tweet.legacy) tweet = tweet.tweet
    var core = tweet.core || {}
    var legacy = tweet.legacy || {}
    var userResult = core.user_results && core.user_results.result
    if (userResult && userResult.result) userResult = userResult.result
    var authorNorm = this._normaliseUserResult(userResult)
    var author = userResult && (userResult.legacy || userResult.core || userResult)
    var authorId = authorNorm.id
    if (authorNorm.username) this._rememberProfile(authorNorm)
    var text = legacy.full_text || legacy.text

    var mediaUrls = []
    var media = (legacy.entities && legacy.entities.media) ||
      (legacy.extended_entities && legacy.extended_entities.media) || []
    media.forEach(function (m) { if (m.media_url_https || m.media_url) mediaUrls.push(m.media_url_https || m.media_url) })

    this._add(NarsilSchema.post('twitter', {
      id:              legacy.id_str || tweet.rest_id,
      author_id:       legacy.user_id_str || authorId,
      author_username: authorNorm.username || (author && (author.screen_name || author.username)),
      content:         text,
      media_urls:      mediaUrls,
      likes:           legacy.favorite_count,
      comments:        legacy.reply_count,
      shares:          legacy.retweet_count,
      views:           tweet.views && tweet.views.count,
      published_at:    legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
      url:             (authorNorm.username || (author && (author.screen_name || author.username))) && legacy.id_str
        ? 'https://x.com/' + (authorNorm.username || author.screen_name || author.username) + '/status/' + legacy.id_str
        : null,
      network_specific: { source: 'passive_graphql', lang: legacy.lang, app_source: legacy.source },
    }))
  },

  _walkGQL: function (obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 16) return
    if (Array.isArray(obj)) {
      var selfA = this
      obj.forEach(function (i) { selfA._walkGQL(i, depth + 1) })
      return
    }

    if (obj.__typename === 'User' || (obj.rest_id && (obj.legacy || obj.core || obj.profile_bio || obj.avatar))) {
      this._cacheUserResult(obj)
      if (obj.legacy) this._parseUser(obj)
    }
    if (obj.user_results && obj.user_results.result) this._cacheUserResult(obj.user_results.result)
    if (obj.result && obj.result.__typename === 'User') this._cacheUserResult(obj.result)
    if (obj.legacy && (obj.rest_id || obj.id_str || obj.id) && (obj.legacy.screen_name || obj.legacy.username)) this._cacheUserResult(obj)
    if (obj.__typename === 'TweetWithVisibilityResults' && obj.tweet) this._parseTweet(obj.tweet)
    if ((obj.__typename === 'Tweet' || obj.legacy && obj.legacy.id_str) && (obj.core || obj.tweet)) this._parseTweet(obj)

    var self = this
    Object.keys(obj).forEach(function (k) { self._walkGQL(obj[k], depth + 1) })
  },

  onPageData: function () {},

  onNetworkRequest: function (url, body) {
    if (!/(?:twitter|x)\.com/i.test(url || '')) return
    if (!body) return
    try { this._walkGQL(body, 0) } catch (_) {}
  },

  _requestNetworkReplay: function (delayMs) {
    try {
      window.postMessage({ __narsil_cmd: 'EXTRACT_PAGE_DATA' }, '*')
    } catch (_) {}
    return new Promise(function (resolve) {
      setTimeout(resolve, delayMs || 450)
    })
  },

  _cacheUserResult: function (u) {
    if (!u) return
    if (u.result) u = u.result
    if (u.user) u = u.user
    var norm = this._normaliseUserResult(u)
    if (norm.username) this._rememberProfile(norm)
  },

  _normaliseUserResult: function (u) {
    if (!u) return {}
    if (u.result) u = u.result
    if (u.user) u = u.user
    var legacy = u.legacy || {}
    var core = u.core || {}
    var profileBio = u.profile_bio || u.profileBio || {}
    var avatar = u.avatar || {}
    var username = legacy.screen_name || legacy.username || core.screen_name || core.username ||
      core.userName || u.screen_name || u.username || u.userName || ''
    var id = u.rest_id || legacy.id_str || legacy.id || core.id_str || core.id || u.id_str || u.id || ''
    var displayName = legacy.name || core.name || u.name || ''
    var bio = legacy.description || profileBio.description || u.description || ''
    var avatarUrl = legacy.profile_image_url_https || avatar.image_url || avatar.image_url_https ||
      avatar.url || u.profile_image_url_https || ''
    return {
      id: id ? String(id) : '',
      username: username,
      display_name: displayName,
      bio: bio,
      avatar_url: avatarUrl ? String(avatarUrl).replace('_normal', '') : '',
    }
  },

  _rememberProfile: function (profile) {
    if (!profile || !profile.username) return
    var key = String(profile.username).replace(/^@/, '').toLowerCase()
    var prev = this._profileCache[key] || {}
    this._profileCache[key] = {
      id: profile.id || prev.id || '',
      username: profile.username || prev.username || '',
      display_name: profile.display_name || prev.display_name || '',
      bio: profile.bio || prev.bio || '',
      avatar_url: profile.avatar_url || prev.avatar_url || '',
    }
  },

  _lookupProfileCache: function (username) {
    if (!username) return {}
    return this._profileCache[String(username).replace(/^@/, '').toLowerCase()] || {}
  },

  _extractUserFromReactNode: function (root, username) {
    if (!root || typeof NarsilReact === 'undefined' || !NarsilReact.fiber) return {}
    var target = username ? String(username).replace(/^@/, '').toLowerCase() : ''
    var nodes = [root]
    if (root.querySelectorAll) {
      Array.prototype.slice.call(root.querySelectorAll('[data-testid="UserName"], [data-testid="User-Name"], [data-testid="UserCell"], a[href^="/"]'), 0, 80)
        .forEach(function (n) { nodes.push(n) })
    }

    for (var i = 0; i < nodes.length; i++) {
      var fiber = NarsilReact.fiber(nodes[i])
      var depth = 0
      while (fiber && depth < 24) {
        var props = fiber.memoizedProps || fiber.pendingProps
        var found = this._findUserInObject(props, target, 0, [])
        if (found.id) return found

        var hook = fiber.memoizedState
        var hookDepth = 0
        while (hook && hookDepth < 12) {
          found = this._findUserInObject(hook.memoizedState, target, 0, [])
          if (found.id) return found
          hook = hook.next
          hookDepth++
        }

        fiber = fiber.return
        depth++
      }
    }
    return {}
  },

  _findUserInObject: function (obj, targetUsername, depth, seen) {
    if (!obj || typeof obj !== 'object' || depth > 7) return {}
    if (seen.indexOf(obj) >= 0) return {}
    seen.push(obj)

    var norm = this._normaliseUserResult(obj)
    if (norm.id && norm.username && (!targetUsername || norm.username.toLowerCase() === targetUsername)) {
      return norm
    }

    var keys = Object.keys(obj)
    keys.sort(function (a, b) {
      var au = /user|result|core|legacy/i.test(a) ? 0 : 1
      var bu = /user|result|core|legacy/i.test(b) ? 0 : 1
      return au - bu
    })
    for (var i = 0; i < keys.length && i < 120; i++) {
      var value = obj[keys[i]]
      if (!value || typeof value !== 'object') continue
      var found = this._findUserInObject(value, targetUsername, depth + 1, seen)
      if (found.id) return found
    }
    return {}
  },

  // ==========================================================================
  // Helpers
  // ==========================================================================

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

  _isSensitivePath: function (path) {
    return /^\/messages(?:\/|$)/.test(path) ||
      /^\/settings(?:\/|$)/.test(path) ||
      /^\/i\/flow(?:\/|$)/.test(path)
  },

  _currentProfileHandle: function () {
    var m = String(location.pathname || '').match(/^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|media|highlights|articles))?\/?$/)
    return m && !this._isReservedHandle(m[1]) ? m[1] : ''
  },

  _connectionInfo: function () {
    var m = String(location.pathname || '').match(/^\/([A-Za-z0-9_]{1,15})\/(followers|following|verified_followers|followers_you_follow)\/?$/)
    if (!m) return { owner: '', type: '' }
    return {
      owner: m[1],
      type: m[2] === 'following' ? 'following'
        : m[2] === 'verified_followers' ? 'verified_followers'
        : m[2] === 'followers_you_follow' ? 'followers_you_follow'
        : 'followers',
    }
  },

  _text: function (el) {
    if (!el) return ''
    return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  },

  _absoluteUrl: function (href) {
    if (!href) return ''
    try { return new URL(href, location.origin).href } catch (_) { return href }
  },

  _parseUserNameBlock: function (el) {
    var result = { displayName: '', username: '' }
    if (!el) return result

    var links = Array.prototype.slice.call(el.querySelectorAll('a[href^="/"]'))
    for (var i = 0; i < links.length && !result.username; i++) {
      var m = String(links[i].getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})(?:\?.*)?$/)
      if (m && !this._isReservedHandle(m[1])) result.username = m[1]
    }

    var raw = this._text(el)
    var hm = raw.match(/@([A-Za-z0-9_]{1,15})/)
    if (!result.username && hm && !this._isReservedHandle(hm[1])) result.username = hm[1]

    var chunks = raw.split(/(?:\n|·|\|)/).map(function (s) { return s.trim() }).filter(Boolean)
    for (var c = 0; c < chunks.length; c++) {
      var candidate = chunks[c].replace(/@([A-Za-z0-9_]{1,15})/, '').trim()
      if (!result.displayName && candidate && candidate.charAt(0) !== '@' && !/^\d+[smhd]$/i.test(candidate)) {
        result.displayName = candidate
      }
    }
    return result
  },

  _isReservedHandle: function (value) {
    return /^(home|explore|search|notifications|messages|settings|i|compose|login|logout|tos|privacy|jobs|download|intent|share|hashtag)$/i.test(value || '')
  },

  _extractProfileId: function (doc, username) {
    var attr = this._extractIdFromNode(doc)
    if (attr.id) return attr

    var route = doc.querySelector('a[href*="/i/user/"]')
    if (route) {
      var rm = String(route.getAttribute('href') || '').match(/\/i\/user\/(\d{5,25})/)
      if (rm) return { id: rm[1], source: 'dom_route' }
    }

    var script = this._extractProfileIdFromScripts(doc, username)
    if (script.id) return script
    return { id: null, source: null }
  },

  _extractIdFromNode: function (root) {
    var attrs = ['data-user-id', 'data-userid', 'data-rest-id', 'data-user-rest-id']
    if (root && root.getAttribute) {
      for (var a = 0; a < attrs.length; a++) {
        var direct = root.getAttribute(attrs[a])
        if (/^\d{5,25}$/.test(direct || '')) return { id: direct, source: 'dom_attribute:' + attrs[a] }
      }
    }
    var nodes = root.querySelectorAll ? root.querySelectorAll('[data-user-id], [data-userid], [data-rest-id], [data-user-rest-id]') : []
    for (var i = 0; i < nodes.length; i++) {
      for (var j = 0; j < attrs.length; j++) {
        var value = nodes[i].getAttribute(attrs[j])
        if (/^\d{5,25}$/.test(value || '')) return { id: value, source: 'dom_attribute:' + attrs[j] }
      }
    }
    return { id: null, source: null }
  },

  _extractProfileIdFromScripts: function (doc, username) {
    if (!username) return { id: null, source: null }
    var lowerUser = String(username).toLowerCase()
    var scripts = doc.querySelectorAll('script')
    var idPatterns = [
      /"rest_id"\s*:\s*"?(\d{5,25})"?/i,
      /"id_str"\s*:\s*"(\d{5,25})"/i,
      /"user_id"\s*:\s*"?(\d{5,25})"?/i,
      /"userId"\s*:\s*"?(\d{5,25})"?/i,
    ]
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || ''
      if (!text || text.length > 2000000) continue
      var idx = text.toLowerCase().indexOf(lowerUser)
      if (idx < 0) continue
      var slice = text.slice(Math.max(0, idx - 5000), Math.min(text.length, idx + 5000))
      for (var p = 0; p < idPatterns.length; p++) {
        var m = slice.match(idPatterns[p])
        if (m) return { id: m[1], source: 'embedded_script' }
      }
    }
    return { id: null, source: null }
  },

  _extractVisibleCounts: function (doc, username) {
    var out = {}
    username = username || ''
    var anchors = doc.querySelectorAll('a[href]')
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute('href') || ''
      var text = this._text(anchors[i])
      if (!text) continue
      if (username && new RegExp('^/' + username + '/following/?$', 'i').test(href)) out.following = text
      else if (username && new RegExp('^/' + username + '/followers/?$', 'i').test(href)) out.followers = text
      else if (username && new RegExp('^/' + username + '/verified_followers/?$', 'i').test(href)) out.verified_followers = text
    }
    var main = doc.querySelector('main')
    var mainText = this._text(main)
    var posts = mainText.match(/([\d.,]+\s*(?:K|M|mil|millones)?)\s+(?:posts|tweets|publicaciones)/i)
    if (posts) out.posts = posts[1]
    return out
  },

  _extractBannerUrl: function (doc) {
    var imgs = doc.querySelectorAll('main img[src]')
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].currentSrc || imgs[i].src || imgs[i].getAttribute('src') || ''
      if (/profile_banners/i.test(src)) return src
    }
    return ''
  },

  _statusFromArticle: function (article) {
    var links = article.querySelectorAll('a[href*="/status/"]')
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || links[i].href || ''
      var m = href.match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,30})/)
      if (m) return { id: m[2], url: this._absoluteUrl('/' + m[1] + '/status/' + m[2]) }
    }
    return { id: '', url: '' }
  },

  _handleFromTweetArticle: function (root) {
    var links = root.querySelectorAll('a[href^="/"]')
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || ''
      var m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\?.*)?$/)
      if (m && !this._isReservedHandle(m[1])) return m[1]
    }
    return ''
  },

  _extractMetric: function (article, testId) {
    var el = article.querySelector('[data-testid="' + testId + '"]')
    if (!el) return null
    return this._parseVisibleNumber(el.getAttribute('aria-label') || this._text(el))
  },

  _extractViews: function (article) {
    var analytics = article.querySelector('a[href$="/analytics"], a[aria-label*="view"], a[aria-label*="visualiz"]')
    return analytics ? this._parseVisibleNumber(analytics.getAttribute('aria-label') || this._text(analytics)) : null
  },

  _parseVisibleNumber: function (raw) {
    raw = String(raw || '').replace(/\u00a0/g, ' ').trim()
    if (!raw) return null
    var m = raw.match(/(\d+(?:[.,]\d+)?)(?:\s*(k|m|mil|millones|million|millions))?/i)
    if (!m) return null
    var n = parseFloat(m[1].replace(',', '.'))
    if (!isFinite(n)) return null
    var suffix = (m[2] || '').toLowerCase()
    if (suffix === 'k' || suffix === 'mil') n *= 1000
    else if (suffix === 'm' || suffix === 'million' || suffix === 'millions' || suffix === 'millones') n *= 1000000
    return Math.round(n)
  },

  _extractTweetMedia: function (article) {
    var media = []
    Array.prototype.forEach.call(article.querySelectorAll('[data-testid="tweetPhoto"] img[src]'), function (img) {
      var src = img.currentSrc || img.src || img.getAttribute('src')
      if (src) media.push({ type: 'image', url: src, alt: img.getAttribute('alt') || '' })
    })
    Array.prototype.forEach.call(article.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"], video'), function (el) {
      var video = el.tagName && el.tagName.toLowerCase() === 'video' ? el : el.querySelector('video')
      media.push({
        type: 'video',
        url: video ? (video.currentSrc || video.src || '') : '',
        poster_url: video ? (video.getAttribute('poster') || '') : '',
      })
    })
    return this._dedupeObjects(media, function (m) { return m.type + ':' + (m.url || m.poster_url || '') })
  },

  _extractTweetLinks: function (article) {
    var links = []
    var self = this
    Array.prototype.forEach.call(article.querySelectorAll('a[href^="https://t.co/"]'), function (a) {
      links.push({ href: a.href || a.getAttribute('href'), text: self._text(a) })
    })
    return this._dedupeObjects(links, function (l) { return l.href + ':' + l.text })
  },

  _extractMentions: function (article, textEl) {
    var out = []
    var scope = textEl || article
    var self = this
    Array.prototype.forEach.call(scope.querySelectorAll('a[href^="/"]'), function (a) {
      var href = a.getAttribute('href') || ''
      var text = self._text(a)
      var m = href.match(/^\/([A-Za-z0-9_]{1,15})(?:\?.*)?$/)
      if (m && !self._isReservedHandle(m[1]) && /^@/.test(text)) out.push('@' + m[1])
    })
    return this._unique(out)
  },

  _extractHashtags: function (article, textEl) {
    var out = []
    var scope = textEl || article
    var self = this
    Array.prototype.forEach.call(scope.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href') || ''
      var text = self._text(a)
      var m = href.match(/\/hashtag\/([^/?#]+)/)
      if (m) out.push('#' + decodeURIComponent(m[1]))
      var q = href.match(/[?&]q=([^&#]+)/)
      if (q && /%23/i.test(q[1])) out.push('#' + decodeURIComponent(q[1]).replace(/^#/, ''))
      if (/^#[A-Za-z0-9_]+$/.test(text)) out.push(text)
    })
    return this._unique(out)
  },

  _extractCashtags: function (article, textEl) {
    var out = []
    var scope = textEl || article
    var self = this
    Array.prototype.forEach.call(scope.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href') || ''
      var text = self._text(a)
      var q = href.match(/[?&]q=([^&#]+)/)
      if (q && /%24/i.test(q[1])) out.push('$' + decodeURIComponent(q[1]).replace(/^\$/, '').toUpperCase())
      if (/^\$[A-Z]{1,8}(?:\.[A-Z]{1,2})?$/i.test(text)) out.push(text.toUpperCase())
    })
    return this._unique(out)
  },

  _extractRelationshipHints: function (article) {
    var text = this._text(article)
    var out = []
    if (/\b(Pinned|Fijado|Fijada)\b/i.test(text)) out.push('pinned')
    if (/\b(Reposted|Republico|Reposteado|Retweeted)\b/i.test(text)) out.push('repost')
    if (/\b(Replying to|Respondiendo a|En respuesta a)\b/i.test(text)) out.push('reply')
    if (/\b(Quote|Cita|Citado)\b/i.test(text)) out.push('quote')
    return out
  },

  _extractUserCellBio: function (cell, parsed) {
    var cloneText = this._text(cell)
    if (!cloneText) return ''
    var parts = cloneText.split(/(?=@[A-Za-z0-9_]{1,15})/)
    var text = parts.length > 1 ? parts.slice(1).join(' ') : cloneText
    text = text.replace('@' + (parsed.username || ''), '')
      .replace(parsed.displayName || '', '')
      .replace(/\b(Follow|Following|Seguir|Siguiendo|Follows you|Te sigue)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    return text
  },

  _scrollConnectionsLimited: function (maxIter) {
    maxIter = maxIter || 8
    return new Promise(function (resolve) {
      var previousCount = 0, stable = 0, iter = 0
      function step() {
        window.scrollBy(0, Math.max(900, window.innerHeight || 900))
        setTimeout(function () {
          var count = document.querySelectorAll('[data-testid="UserCell"]').length
          if (count === previousCount) stable++
          else { stable = 0; previousCount = count }
          iter++
          if (iter >= maxIter || stable >= 3 || count >= 120) resolve()
          else step()
        }, 1100)
      }
      step()
    })
  },

  _tweetToSchema: function (tweet) {
    return NarsilSchema.post('twitter', {
      id: tweet.id,
      author_id: tweet.author_id,
      author_username: tweet.author_username,
      content: tweet.content,
      media_urls: tweet.media_urls,
      likes: tweet.likes,
      comments: tweet.comments,
      shares: tweet.shares,
      views: tweet.views,
      published_at: tweet.published_at,
      url: tweet.url,
      network_specific: {
        source: tweet.source,
        author_id_source: tweet.author_id_source,
        author_display_name: tweet.author_display_name,
        published_text: tweet.published_text,
        bookmarks: tweet.bookmarks,
        mentions: tweet.mentions,
        hashtags: tweet.hashtags,
        cashtags: tweet.cashtags,
        external_links: tweet.external_links,
        media: tweet.media,
        relationship_hints: tweet.relationship_hints,
      },
    })
  },

  _profileToText: function (p) {
    var lines = ['X / Twitter profile report', 'Captured: ' + new Date().toISOString(), 'URL: ' + (p.profile_url || location.href), '']
    function add(label, value) { if (value !== null && value !== undefined && value !== '') lines.push(label + ': ' + value) }
    add('Profile ID', p.id)
    add('Profile ID source', p.id_source)
    add('Username', p.username ? '@' + p.username : '')
    add('Display name', p.display_name)
    add('Bio', p.bio)
    add('Location', p.location)
    add('External URL', p.external_url || p.external_url_text)
    add('Join date text', p.join_date_text)
    add('Professional category', p.professional_category)
    add('Verified', p.verified === null ? '' : String(p.verified))
    add('Avatar URL', p.avatar_url)
    add('Banner URL', p.banner_url)
    add('Followers', p.followers_text)
    add('Following', p.following_text)
    add('Verified followers', p.verified_followers_text)
    if (p.warnings && p.warnings.length) add('Warnings', p.warnings.join(', '))
    return lines.join('\n')
  },

  _tweetToText: function (t) {
    var lines = ['X / Twitter tweet report', 'Captured: ' + new Date().toISOString(), '']
    function add(label, value) { if (value !== null && value !== undefined && value !== '') lines.push(label + ': ' + value) }
    add('Status ID', t.id)
    add('URL', t.url)
    add('Author ID', t.author_id)
    add('Author ID source', t.author_id_source)
    add('Author', t.author_username ? '@' + t.author_username : '')
    add('Author display name', t.author_display_name)
    add('Created at', t.published_at || t.published_text)
    add('Text', t.content)
    add('Replies', t.comments)
    add('Reposts', t.shares)
    add('Likes', t.likes)
    add('Bookmarks', t.bookmarks)
    add('Views', t.views)
    add('Mentions', t.mentions.join(', '))
    add('Hashtags', t.hashtags.join(', '))
    add('Cashtags', t.cashtags.join(', '))
    if (t.external_links.length) add('External links', t.external_links.map(function (l) { return l.text ? l.text + ' <' + l.href + '>' : l.href }).join(' | '))
    if (t.media_urls.length) add('Media URLs', t.media_urls.join(' | '))
    if (t.relationship_hints.length) add('Relationship hints', t.relationship_hints.join(', '))
    return lines.join('\n')
  },

  _unique: function (items) {
    var out = [], seen = {}
    ;(items || []).forEach(function (item) {
      var key = typeof item === 'string' ? item : JSON.stringify(item)
      if (seen[key]) return
      seen[key] = true
      out.push(item)
    })
    return out
  },

  _dedupeObjects: function (items, keyFn) {
    var out = [], seen = {}
    ;(items || []).forEach(function (item) {
      var key = keyFn(item)
      if (seen[key]) return
      seen[key] = true
      out.push(item)
    })
    return out
  },
}
