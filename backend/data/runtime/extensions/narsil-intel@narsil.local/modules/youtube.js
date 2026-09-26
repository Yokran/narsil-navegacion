// NARSIL Intel Collector - modules/youtube.js
// Conservative YouTube collector. Active actions read the visible DOM and enrich
// it with passive page/network data that YouTube has already loaded.
'use strict'

NarsilModules.youtube = {
  network:       'youtube',
  collected:     [],
  _seen:         {},
  _channelCache: {},
  _videoCache:   {},

  getPageType: function () {
    var p = location.pathname || '/'
    var s = location.search || ''
    if (p === '/watch' || s.indexOf('v=') !== -1 || /^\/shorts\/[^/]+/.test(p)) return 'video'
    if (/^\/@[^/]+/.test(p) || /^\/channel\/[^/]+/.test(p) || /^\/c\/[^/]+/.test(p) || /^\/user\/[^/]+/.test(p)) return 'channel'
    if (p === '/results' || /^\/search/.test(p)) return 'search'
    return 'other'
  },

  getActions: function () {
    var type = this.getPageType()
    if (type === 'channel') {
      return [
        { id: 'channel_report', label: 'Reporte del canal (TXT)' },
        { id: 'visible_videos', label: 'Videos visibles -> XLSX' },
      ]
    }
    if (type === 'video') {
      return [
        { id: 'video_report', label: 'Reporte del video (TXT)' },
        { id: 'author_report', label: 'Canal del autor (TXT)' },
      ]
    }
    if (type === 'search') return [{ id: 'visible_videos', label: 'Resultados visibles -> XLSX' }]
    return []
  },

  runAction: function (id) {
    switch (id) {
      case 'channel_report': this._actionChannelReport(); break
      case 'video_report':   this._actionVideoReport(); break
      case 'author_report':  this._actionAuthorReport(); break
      case 'visible_videos': this._actionVisibleVideos(); break
    }
  },

  stats: function () {
    var profiles = 0
    var posts = 0
    this.collected.forEach(function (item) {
      if (item._type === 'profile') profiles++
      else if (item._type === 'post') posts++
    })
    return { profiles: profiles, posts: posts, contacts: 0 }
  },

  getItems: function () { return this.collected },

  clear: function () {
    this.collected = []
    this._seen = {}
    this._channelCache = {}
    this._videoCache = {}
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  onPageData: function (key, data) {
    try {
      if (!data || typeof data !== 'object') return
      if (key === 'ytInitialPlayerResponse') this._parsePlayerResponse(data, 'yt_initial_player')
      if (key === 'ytInitialData') this._walkInnerTube(data, 0, 'yt_initial_data')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('YouTube: error procesando datos pasivos - ' + e.message, 'err')
    }
  },

  onNetworkRequest: function (url, body) {
    try {
      if (!/youtube\.com|youtubei/i.test(String(url || '')) || !body || typeof body !== 'object') return
      if (/youtubei\/v\d+\/player/i.test(url)) this._parsePlayerResponse(body, 'youtubei_player')
      if (/youtubei\/v\d+\/(browse|search|next)/i.test(url)) this._walkInnerTube(body, 0, 'youtubei')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('YouTube: error procesando red pasiva - ' + e.message, 'err')
    }
  },

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  _actionChannelReport: function () {
    var self = this
    if (this.getPageType() !== 'channel') {
      NarsilPanel && NarsilPanel.log('YouTube: abre manualmente un canal primero.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('YouTube: preparando reporte del canal...')
    this._requestPageData(450).then(function () {
      var channel = self._extractChannel(document)
      if (!channel.id && !channel.handle && !channel.display_name) {
        NarsilPanel && NarsilPanel.log('YouTube: no se pudo extraer el canal visible.', 'err')
        return
      }
      self._add(self._channelToSchema(channel))
      self._sendDownload(
        (channel.handle || channel.id || self._safeName(channel.display_name) || 'youtube_channel') + '_youtube_channel.txt',
        self._channelToText(channel),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('YouTube: reporte descargado para ' + (channel.display_name || channel.handle || channel.id) + '.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('YouTube: error - ' + e.message, 'err')
    })
  },

  _actionVideoReport: function () {
    var self = this
    if (this.getPageType() !== 'video') {
      NarsilPanel && NarsilPanel.log('YouTube: abre manualmente un video primero.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('YouTube: preparando reporte del video...')
    this._requestPageData(450).then(function () {
      var video = self._extractVideo(document)
      if (!video.id && !video.title) {
        NarsilPanel && NarsilPanel.log('YouTube: no se pudo extraer el video visible.', 'err')
        return
      }
      self._add(self._videoToSchema(video))
      self._sendDownload(
        (video.id || self._safeName(video.title) || 'youtube_video') + '_youtube_video.txt',
        self._videoToText(video),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('YouTube: reporte descargado para video ' + (video.id || video.title) + '.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('YouTube: error - ' + e.message, 'err')
    })
  },

  _actionAuthorReport: function () {
    var self = this
    if (this.getPageType() !== 'video') {
      NarsilPanel && NarsilPanel.log('YouTube: abre manualmente un video primero.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('YouTube: extrayendo canal visible del autor...')
    this._requestPageData(450).then(function () {
      var video = self._extractVideo(document)
      var channel = self._channelFromVideo(video)
      if (!channel.id && !channel.handle && !channel.display_name) {
        NarsilPanel && NarsilPanel.log('YouTube: no se pudo resolver el canal del autor visible.', 'err')
        return
      }
      self._add(self._channelToSchema(channel))
      self._sendDownload(
        (channel.handle || channel.id || self._safeName(channel.display_name) || 'youtube_author') + '_youtube_author_channel.txt',
        self._channelToText(channel),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('YouTube: canal del autor descargado.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('YouTube: error - ' + e.message, 'err')
    })
  },

  _actionVisibleVideos: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('YouTube: extrayendo videos visibles...')
    this._requestPageData(300).then(function () {
      var rows = self._extractVisibleVideoRows(document)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('YouTube: no hay videos visibles capturados.', 'err')
        return
      }
      rows.forEach(function (row) {
        self._add(NarsilSchema.post('youtube', {
          id: row.ID && !row.ID.__narsilMissing ? row.ID : null,
          author_username: row.Canal && !row.Canal.__narsilMissing ? row.Canal : null,
          content: row.Titulo && !row.Titulo.__narsilMissing ? row.Titulo : null,
          media_urls: row.Miniatura && !row.Miniatura.__narsilMissing ? [row.Miniatura] : [],
          url: row.URL && !row.URL.__narsilMissing ? row.URL : null,
          network_specific: { source: 'dom_visible_video' },
        }))
      })
      var bytes = NarsilExport.toXLSX(rows)
      self._sendDownloadBinary(
        'youtube_videos_visibles.xlsx',
        NarsilExport.uint8ToBase64(bytes),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      NarsilPanel && NarsilPanel.log('YouTube: ' + rows.length + ' videos visibles exportados.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('YouTube: error - ' + e.message, 'err')
    })
  },

  // --------------------------------------------------------------------------
  // Passive parsing
  // --------------------------------------------------------------------------

  _parsePlayerResponse: function (data, source) {
    if (!data || typeof data !== 'object') return
    var details = data.videoDetails || {}
    var micro = data.microformat && data.microformat.playerMicroformatRenderer || {}
    var videoId = this._clean(details.videoId || micro.videoId)
    if (!videoId) return
    var video = {
      id: videoId,
      title: this._text(details.title || micro.title),
      description: this._text(details.shortDescription || micro.description),
      channel_id: this._clean(details.channelId || micro.externalChannelId),
      channel_name: this._text(details.author || micro.ownerChannelName),
      channel_url: this._absoluteUrl(micro.ownerProfileUrl || (details.channelId ? '/channel/' + details.channelId : '')),
      thumbnail_url: this._thumb(details.thumbnail || micro.thumbnail),
      views: details.viewCount != null ? Number(details.viewCount) : null,
      duration_seconds: details.lengthSeconds != null ? Number(details.lengthSeconds) : null,
      upload_date: this._clean(micro.uploadDate),
      publish_date: this._clean(micro.publishDate),
      category: this._clean(micro.category),
      keywords: Array.isArray(details.keywords) ? details.keywords.slice(0, 30) : [],
      source: source,
    }
    this._rememberVideo(video)
    if (video.channel_id || video.channel_name) {
      this._rememberChannel({
        id: video.channel_id,
        display_name: video.channel_name,
        url: video.channel_url,
        source: source + '_author',
      })
    }
  },

  _walkInnerTube: function (obj, depth, source) {
    if (!obj || typeof obj !== 'object' || depth > 9) return
    if (Array.isArray(obj)) {
      var self = this
      obj.forEach(function (item) { self._walkInnerTube(item, depth + 1, source) })
      return
    }
    if (obj.channelMetadataRenderer) this._parseChannelMetadata(obj.channelMetadataRenderer, source)
    if (obj.c4TabbedHeaderRenderer) this._parseChannelHeader(obj.c4TabbedHeaderRenderer, source)
    if (obj.pageHeaderRenderer) this._parsePageHeader(obj.pageHeaderRenderer, source)
    if (obj.channelRenderer || obj.gridChannelRenderer) this._parseChannelRenderer(obj.channelRenderer || obj.gridChannelRenderer, source)
    if (obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer || obj.reelItemRenderer) {
      this._parseVideoRenderer(obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer || obj.reelItemRenderer, source)
    }
    var self2 = this
    Object.keys(obj).forEach(function (key) { self2._walkInnerTube(obj[key], depth + 1, source) })
  },

  _parseChannelMetadata: function (r, source) {
    if (!r) return
    this._rememberChannel({
      id: this._clean(r.externalId),
      handle: this._handleFromUrl(r.vanityChannelUrl || r.channelUrl || ''),
      display_name: this._text(r.title),
      description: this._text(r.description),
      url: this._absoluteUrl(r.channelUrl || r.vanityChannelUrl),
      avatar_url: this._thumb(r.avatar),
      external_links: Array.isArray(r.ownerUrls) ? r.ownerUrls.slice(0, 12) : [],
      rss_url: this._clean(r.rssUrl),
      source: source,
    })
  },

  _parseChannelHeader: function (r, source) {
    if (!r) return
    this._rememberChannel({
      id: this._clean(r.channelId),
      handle: this._handleFromEndpoint(r.navigationEndpoint) || this._handleFromUrl(r.channelUrl || ''),
      display_name: this._text(r.title),
      avatar_url: this._thumb(r.avatar),
      banner_url: this._thumb(r.banner || r.tvBanner || r.mobileBanner),
      subscribers_text: this._text(r.subscriberCountText),
      videos_text: this._text(r.videosCountText),
      url: this._absoluteUrl(r.channelUrl || (r.channelId ? '/channel/' + r.channelId : '')),
      source: source,
    })
  },

  _parsePageHeader: function (r, source) {
    var content = r.content || {}
    var header = content.pageHeaderViewModel || content.pageHeaderRenderer || r
    var title = this._text(header.title || header.pageTitle)
    var metadata = this._text(header.metadata || header.description)
    var url = this._endpointUrl(header.imageEndpoint || header.endpoint)
    if (!title && !metadata && !url) return
    this._rememberChannel({
      handle: this._handleFromUrl(url),
      display_name: title,
      description: metadata,
      url: this._absoluteUrl(url),
      source: source,
    })
  },

  _parseChannelRenderer: function (r, source) {
    if (!r) return
    var endpoint = r.navigationEndpoint || {}
    var browse = endpoint.browseEndpoint || {}
    var id = this._clean(r.channelId || browse.browseId)
    var url = this._endpointUrl(endpoint) || (id ? '/channel/' + id : '')
    this._rememberChannel({
      id: id,
      handle: this._handleFromUrl(url),
      display_name: this._text(r.title),
      description: this._text(r.descriptionSnippet),
      avatar_url: this._thumb(r.thumbnail || r.avatar),
      subscribers_text: this._text(r.subscriberCountText),
      videos_text: this._text(r.videoCountText),
      url: this._absoluteUrl(url),
      source: source,
    })
  },

  _parseVideoRenderer: function (r, source) {
    if (!r) return
    var id = this._clean(r.videoId)
    if (!id && r.navigationEndpoint) id = this._videoIdFromUrl(this._endpointUrl(r.navigationEndpoint))
    if (!id) return
    var channelRun = r.ownerText && r.ownerText.runs && r.ownerText.runs[0] ||
      r.shortBylineText && r.shortBylineText.runs && r.shortBylineText.runs[0] ||
      r.longBylineText && r.longBylineText.runs && r.longBylineText.runs[0]
    var channelUrl = channelRun && this._endpointUrl(channelRun.navigationEndpoint)
    var channelId = channelRun && channelRun.navigationEndpoint &&
      channelRun.navigationEndpoint.browseEndpoint && channelRun.navigationEndpoint.browseEndpoint.browseId
    var video = {
      id: id,
      title: this._text(r.title || r.headline),
      description: this._text(r.descriptionSnippet || r.detailedMetadataSnippets),
      channel_id: this._clean(channelId),
      channel_name: this._text(channelRun && channelRun.text),
      channel_url: this._absoluteUrl(channelUrl),
      thumbnail_url: this._thumb(r.thumbnail),
      views_text: this._text(r.viewCountText),
      views: this._parseCompactNumber(this._text(r.viewCountText)),
      published_text: this._text(r.publishedTimeText),
      duration_text: this._text(r.lengthText || r.thumbnailOverlays),
      url: 'https://www.youtube.com/watch?v=' + id,
      source: source,
    }
    this._rememberVideo(video)
    if (video.channel_id || video.channel_name) {
      this._rememberChannel({
        id: video.channel_id,
        handle: this._handleFromUrl(video.channel_url),
        display_name: video.channel_name,
        url: video.channel_url,
        source: source + '_video_owner',
      })
    }
  },

  // --------------------------------------------------------------------------
  // DOM extraction
  // --------------------------------------------------------------------------

  _extractChannel: function (doc) {
    var urlInfo = this._currentChannelUrlInfo(doc)
    var cached = this._lookupChannel(urlInfo)
    var main = doc.querySelector('ytd-app') || doc.querySelector('main') || doc.body
    var visibleText = this._visibleText(main)
    var title = this._firstText([
      'yt-page-header-renderer h1',
      '#channel-header-container #text.ytd-channel-name',
      'ytd-channel-name #text',
      '#text-container yt-formatted-string',
      'h1',
    ], main) || this._meta(doc, 'property', 'og:title')
    var description = this._firstText([
      '#description-container',
      '#description',
      'yt-attributed-string[role="text"]',
    ], main) || this._meta(doc, 'property', 'og:description')
    var subscribersText = this._firstMatchingText(main, /(suscriptores|subscribers)/i)
    var videosText = this._firstMatchingText(main, /(videos)/i)
    var counts = this._extractChannelCounts(visibleText)
    var channel = this._merge(cached, {
      id: urlInfo.id || this._meta(doc, 'itemprop', 'channelId') || cached.id || null,
      handle: urlInfo.handle || cached.handle || null,
      display_name: title || cached.display_name || null,
      description: description || cached.description || null,
      url: urlInfo.url || cached.url || window.location.href,
      avatar_url: this._meta(doc, 'property', 'og:image') || this._imageSrc([
        '#avatar img',
        'yt-decorated-avatar-view-model img',
        'ytd-channel-avatar-editor img',
        'img[src*="yt3.ggpht.com"]',
        'img[src*="yt3.googleusercontent.com"]',
      ], main) || cached.avatar_url || null,
      banner_url: this._imageSrc([
        '#page-header-banner img',
        'yt-image-banner-view-model img',
        'ytd-c4-tabbed-header-renderer #banner img',
      ], main) || cached.banner_url || null,
      subscribers_text: subscribersText || cached.subscribers_text || null,
      subscribers: counts.subscribers != null ? counts.subscribers : cached.subscribers,
      videos_text: videosText || cached.videos_text || null,
      videos_count: counts.videos != null ? counts.videos : cached.videos_count,
      views_text: counts.views_text || cached.views_text || null,
      joined_text: counts.joined_text || cached.joined_text || null,
      verified: this._verified(main),
      external_links: this._externalLinks(doc),
      source: cached.source ? 'dom_channel,' + cached.source : 'dom_channel',
      warnings: [],
    })
    if (!channel.id) channel.warnings.push('channel_id_not_found_visible_or_passive')
    if (!channel.description) channel.warnings.push('description_not_visible')
    this._rememberChannel(channel)
    return channel
  },

  _extractVideo: function (doc) {
    var id = this._currentVideoId()
    var cached = this._videoCache['id:' + id] || {}
    var main = doc.querySelector('ytd-watch-flexy') || doc.querySelector('main') || doc.body
    var title = this._firstText([
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1 yt-formatted-string',
      'h1.title',
      'h1',
    ], main) || cached.title
    var channelLink = doc.querySelector('#channel-name a[href], ytd-video-owner-renderer a[href], ytd-channel-name a[href]')
    var channelUrl = channelLink ? this._absoluteUrl(channelLink.getAttribute('href') || channelLink.href) : cached.channel_url
    var channelName = this._clean(channelLink && channelLink.textContent) ||
      this._firstText(['#channel-name', 'ytd-channel-name #text'], main) || cached.channel_name
    var descriptionRoot = doc.querySelector('#description, #description-inline-expander, ytd-text-inline-expander') || main
    var description = this._visibleText(descriptionRoot) || cached.description || ''
    var visibleText = this._visibleText(main)
    var viewsText = this._firstMatchingText(main, /(visualizaciones|views)/i) || cached.views_text
    var video = this._merge(cached, {
      id: id || cached.id || null,
      title: title || null,
      description: description || null,
      channel_id: this._channelIdFromUrl(channelUrl) || cached.channel_id || null,
      channel_handle: this._handleFromUrl(channelUrl) || cached.channel_handle || null,
      channel_name: channelName || null,
      channel_url: channelUrl || cached.channel_url || null,
      views_text: viewsText || null,
      views: this._parseCompactNumber(viewsText) || cached.views || null,
      publish_date: cached.publish_date || cached.upload_date || this._dateText(visibleText) || null,
      duration_seconds: cached.duration_seconds || null,
      category: cached.category || null,
      thumbnail_url: cached.thumbnail_url || (id ? 'https://img.youtube.com/vi/' + id + '/maxresdefault.jpg' : null),
      likes_text: this._likeText(doc),
      hashtags: this._hashtags(description + '\n' + title),
      external_links: this._externalLinks(descriptionRoot),
      source: cached.source ? 'dom_video,' + cached.source : 'dom_video',
      warnings: [],
    })
    if (!video.id) video.warnings.push('video_id_not_found')
    if (!video.channel_id) video.warnings.push('channel_id_not_found_visible_or_passive')
    this._rememberVideo(video)
    if (video.channel_id || video.channel_name || video.channel_handle) this._rememberChannel(this._channelFromVideo(video))
    return video
  },

  _extractVisibleVideoRows: function (doc) {
    var nodes = Array.prototype.slice.call(doc.querySelectorAll(
      'ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer'
    ))
    if (!nodes.length) {
      nodes = Array.prototype.slice.call(doc.querySelectorAll('a#video-title[href], a[href*="/watch?v="], a[href^="/shorts/"]'))
        .map(function (a) { return a.closest('ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer') || a })
    }
    var self = this
    var rows = []
    var seen = {}
    nodes.forEach(function (node) {
      var titleLink = node.matches && node.matches('a[href]') ? node :
        node.querySelector('a#video-title[href], a[href*="/watch?v="], a[href^="/shorts/"]')
      var href = titleLink && (titleLink.getAttribute('href') || titleLink.href)
      var url = self._absoluteUrl(href)
      var id = self._videoIdFromUrl(url)
      if (!id || seen[id]) return
      seen[id] = true
      var title = self._clean((titleLink && (titleLink.getAttribute('title') || titleLink.textContent)) || '')
      var channelLink = node.querySelector('ytd-channel-name a[href], #channel-name a[href], a[href^="/@"]')
      var metaLines = Array.prototype.slice.call(node.querySelectorAll('#metadata-line span, .inline-metadata-item, span'))
        .map(function (el) { return self._clean(el.textContent) })
        .filter(Boolean)
      rows.push({
        'ID': id,
        'Titulo': title || NarsilExport.missing('titulo no visible'),
        'Canal': self._clean(channelLink && channelLink.textContent) || NarsilExport.missing('canal no visible'),
        'Canal ID': self._channelIdFromUrl(channelLink && (channelLink.getAttribute('href') || channelLink.href)) ||
          NarsilExport.missing('id no capturado'),
        'URL': url,
        'Miniatura': self._imageSrc(['img'], node) || NarsilExport.missing('miniatura no visible'),
        'Duracion': self._firstMatchingText(node, /^\d{1,2}:\d{2}/) || NarsilExport.missing('duracion no visible'),
        'Visualizaciones': metaLines.find(function (t) { return /(visualizaciones|views)/i.test(t) }) || NarsilExport.missing('no visible'),
        'Fecha': metaLines.find(function (t) { return /(hace|ago|day|week|month|year|dia|semana|mes|ano)/i.test(self._fold(t)) }) || NarsilExport.missing('no visible'),
        'Fuente': 'dom_visible',
      })
    })
    return rows.slice(0, 80)
  },

  // --------------------------------------------------------------------------
  // Output
  // --------------------------------------------------------------------------

  _channelToSchema: function (c) {
    return NarsilSchema.profile('youtube', {
      id: c.id,
      username: c.handle,
      display_name: c.display_name,
      bio: c.description,
      avatar_url: c.avatar_url,
      followers: c.subscribers,
      posts: c.videos_count,
      url: c.url,
      verified: c.verified,
      network_specific: {
        source: c.source,
        subscribers_text: c.subscribers_text,
        videos_text: c.videos_text,
        views_text: c.views_text,
        joined_text: c.joined_text,
        banner_url: c.banner_url,
        external_links: c.external_links,
        rss_url: c.rss_url,
        warnings: c.warnings,
      },
    })
  },

  _videoToSchema: function (v) {
    return NarsilSchema.post('youtube', {
      id: v.id,
      author_id: v.channel_id,
      author_username: v.channel_handle || v.channel_name,
      content: v.title,
      media_urls: v.thumbnail_url ? [v.thumbnail_url] : [],
      views: v.views,
      published_at: v.publish_date || v.upload_date,
      url: v.url || (v.id ? 'https://www.youtube.com/watch?v=' + v.id : location.href),
      network_specific: {
        source: v.source,
        channel_name: v.channel_name,
        channel_url: v.channel_url,
        description: v.description,
        duration_seconds: v.duration_seconds,
        category: v.category,
        likes_text: v.likes_text,
        hashtags: v.hashtags,
        external_links: v.external_links,
        warnings: v.warnings,
      },
    })
  },

  _channelToText: function (c) {
    var lines = ['YouTube channel report', 'Captured: ' + new Date().toISOString(), 'URL: ' + (c.url || location.href), '']
    this._addLine(lines, 'Channel ID', c.id)
    this._addLine(lines, 'Handle', c.handle)
    this._addLine(lines, 'Name', c.display_name)
    this._addLine(lines, 'Subscribers', c.subscribers_text || c.subscribers)
    this._addLine(lines, 'Videos', c.videos_text || c.videos_count)
    this._addLine(lines, 'Views', c.views_text)
    this._addLine(lines, 'Joined', c.joined_text)
    this._addLine(lines, 'Verified', c.verified)
    this._addLine(lines, 'Avatar URL', c.avatar_url)
    this._addLine(lines, 'Banner URL', c.banner_url)
    this._addBlock(lines, 'Description', c.description)
    if (c.external_links && c.external_links.length) this._addBlock(lines, 'Visible external links', c.external_links.join('\n'))
    if (c.rss_url) this._addLine(lines, 'RSS URL', c.rss_url)
    if (c.warnings && c.warnings.length) this._addLine(lines, 'Warnings', c.warnings.join(', '))
    return lines.join('\n')
  },

  _videoToText: function (v) {
    var lines = ['YouTube video report', 'Captured: ' + new Date().toISOString(), 'URL: ' + (v.url || location.href), '']
    this._addLine(lines, 'Video ID', v.id)
    this._addLine(lines, 'Title', v.title)
    this._addLine(lines, 'Channel ID', v.channel_id)
    this._addLine(lines, 'Channel handle', v.channel_handle)
    this._addLine(lines, 'Channel name', v.channel_name)
    this._addLine(lines, 'Channel URL', v.channel_url)
    this._addLine(lines, 'Views', v.views_text || v.views)
    this._addLine(lines, 'Published', v.publish_date || v.upload_date)
    this._addLine(lines, 'Duration seconds', v.duration_seconds)
    this._addLine(lines, 'Category', v.category)
    this._addLine(lines, 'Likes', v.likes_text)
    this._addLine(lines, 'Thumbnail URL', v.thumbnail_url)
    this._addBlock(lines, 'Description', v.description)
    if (v.hashtags && v.hashtags.length) this._addLine(lines, 'Hashtags', v.hashtags.join(', '))
    if (v.external_links && v.external_links.length) this._addBlock(lines, 'Visible external links', v.external_links.join('\n'))
    if (v.warnings && v.warnings.length) this._addLine(lines, 'Warnings', v.warnings.join(', '))
    return lines.join('\n')
  },

  // --------------------------------------------------------------------------
  // Cache helpers
  // --------------------------------------------------------------------------

  _rememberChannel: function (channel) {
    if (!channel) return null
    var normalized = this._normalizeChannel(channel)
    var keys = []
    if (normalized.id) keys.push('id:' + normalized.id)
    if (normalized.handle) keys.push('h:' + normalized.handle.toLowerCase())
    if (normalized.url) keys.push('url:' + normalized.url.toLowerCase())
    if (!keys.length) return normalized
    var prev = this._channelCache[keys[0]] || {}
    var merged = this._merge(prev, normalized)
    merged.source = this._appendSource(prev.source, normalized.source)
    var cache = this._channelCache
    keys.forEach(function (key) { cache[key] = merged })
    return merged
  },

  _rememberVideo: function (video) {
    if (!video) return null
    var normalized = this._normalizeVideo(video)
    if (!normalized.id) return normalized
    var key = 'id:' + normalized.id
    var prev = this._videoCache[key] || {}
    var merged = this._merge(prev, normalized)
    merged.source = this._appendSource(prev.source, normalized.source)
    this._videoCache[key] = merged
    return merged
  },

  _lookupChannel: function (info) {
    info = info || {}
    var byId = info.id && this._channelCache['id:' + info.id]
    var byHandle = info.handle && this._channelCache['h:' + info.handle.toLowerCase()]
    var byUrl = info.url && this._channelCache['url:' + info.url.toLowerCase()]
    return byId || byHandle || byUrl || {}
  },

  _normalizeChannel: function (c) {
    return {
      id: this._clean(c.id),
      handle: this._clean(c.handle).replace(/^@?/, function (m) { return m ? '@' : '' }),
      display_name: this._clean(c.display_name),
      description: this._clean(c.description),
      url: this._absoluteUrl(c.url),
      avatar_url: this._clean(c.avatar_url),
      banner_url: this._clean(c.banner_url),
      subscribers_text: this._clean(c.subscribers_text),
      subscribers: c.subscribers != null ? Number(c.subscribers) : this._parseCompactNumber(c.subscribers_text),
      videos_text: this._clean(c.videos_text),
      videos_count: c.videos_count != null ? Number(c.videos_count) : this._parseCompactNumber(c.videos_text),
      views_text: this._clean(c.views_text),
      joined_text: this._clean(c.joined_text),
      verified: c.verified != null ? !!c.verified : null,
      external_links: Array.isArray(c.external_links) ? c.external_links : [],
      rss_url: this._clean(c.rss_url),
      source: this._clean(c.source),
      warnings: Array.isArray(c.warnings) ? c.warnings : [],
    }
  },

  _normalizeVideo: function (v) {
    return {
      id: this._clean(v.id),
      title: this._clean(v.title),
      description: this._clean(v.description),
      channel_id: this._clean(v.channel_id),
      channel_handle: this._clean(v.channel_handle),
      channel_name: this._clean(v.channel_name),
      channel_url: this._absoluteUrl(v.channel_url),
      thumbnail_url: this._clean(v.thumbnail_url),
      views_text: this._clean(v.views_text),
      views: v.views != null ? Number(v.views) : this._parseCompactNumber(v.views_text),
      publish_date: this._clean(v.publish_date),
      upload_date: this._clean(v.upload_date),
      published_text: this._clean(v.published_text),
      duration_text: this._clean(v.duration_text),
      duration_seconds: v.duration_seconds != null ? Number(v.duration_seconds) : null,
      category: this._clean(v.category),
      keywords: Array.isArray(v.keywords) ? v.keywords : [],
      likes_text: this._clean(v.likes_text),
      hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
      external_links: Array.isArray(v.external_links) ? v.external_links : [],
      url: v.url || (v.id ? 'https://www.youtube.com/watch?v=' + v.id : ''),
      source: this._clean(v.source),
      warnings: Array.isArray(v.warnings) ? v.warnings : [],
    }
  },

  _channelFromVideo: function (video) {
    video = video || {}
    return this._merge(this._lookupChannel({
      id: video.channel_id,
      handle: video.channel_handle,
      url: video.channel_url,
    }), {
      id: video.channel_id,
      handle: video.channel_handle,
      display_name: video.channel_name,
      url: video.channel_url,
      source: 'video_author',
      warnings: video.channel_id ? [] : ['channel_id_not_found_visible_or_passive'],
    })
  },

  // --------------------------------------------------------------------------
  // Low-level helpers
  // --------------------------------------------------------------------------

  _currentVideoId: function () {
    var p = location.pathname || ''
    var m = /^\/shorts\/([^/?#]+)/.exec(p)
    if (m) return m[1]
    return new URLSearchParams(location.search || '').get('v') || ''
  },

  _currentChannelUrlInfo: function (doc) {
    var canonical = doc.querySelector('link[rel="canonical"]')
    var href = canonical && canonical.href || window.location.href
    var info = { id: this._channelIdFromUrl(href), handle: this._handleFromUrl(href), url: this._absoluteUrl(href) }
    if (!info.id) info.id = this._meta(doc, 'itemprop', 'channelId')
    return info
  },

  _channelIdFromUrl: function (href) {
    var m = /youtube\.com\/channel\/(UC[\w-]+)/i.exec(String(href || '')) || /\/channel\/(UC[\w-]+)/i.exec(String(href || ''))
    return m ? m[1] : ''
  },

  _handleFromUrl: function (href) {
    var m = /(?:youtube\.com)?\/(@[^/?#]+)/i.exec(String(href || ''))
    return m ? decodeURIComponent(m[1]) : ''
  },

  _handleFromEndpoint: function (endpoint) {
    return this._handleFromUrl(this._endpointUrl(endpoint))
  },

  _videoIdFromUrl: function (href) {
    href = String(href || '')
    var shorts = /\/shorts\/([^/?#]+)/.exec(href)
    if (shorts) return shorts[1]
    try {
      var u = new URL(href, location.origin)
      return u.searchParams.get('v') || ''
    } catch (_) {
      var m = /[?&]v=([^&#]+)/.exec(href)
      return m ? m[1] : ''
    }
  },

  _endpointUrl: function (endpoint) {
    if (!endpoint) return ''
    if (typeof endpoint === 'string') return endpoint
    if (endpoint.commandMetadata && endpoint.commandMetadata.webCommandMetadata) {
      return endpoint.commandMetadata.webCommandMetadata.url || ''
    }
    if (endpoint.browseEndpoint) return endpoint.browseEndpoint.canonicalBaseUrl || ''
    if (endpoint.watchEndpoint && endpoint.watchEndpoint.videoId) return '/watch?v=' + endpoint.watchEndpoint.videoId
    if (endpoint.reelWatchEndpoint && endpoint.reelWatchEndpoint.videoId) return '/shorts/' + endpoint.reelWatchEndpoint.videoId
    return ''
  },

  _absoluteUrl: function (href) {
    href = this._clean(href)
    if (!href) return ''
    try { return new URL(href, location.origin).href } catch (_) { return href }
  },

  _externalLinks: function (root) {
    var out = []
    var seen = {}
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('a[href]') : []).forEach(function (a) {
      var href = a.href || a.getAttribute('href') || ''
      try {
        var u = new URL(href, location.origin)
        if (u.hostname.indexOf('youtube.com') !== -1 && u.pathname === '/redirect') href = u.searchParams.get('q') || href
      } catch (_) {}
      if (!/^https?:/i.test(href)) return
      if (/\/\/(?:www\.)?(youtube\.com|youtu\.be)\//i.test(href)) return
      if (seen[href]) return
      seen[href] = true
      out.push(href)
    })
    return out.slice(0, 20)
  },

  _extractChannelCounts: function (text) {
    text = this._clean(text)
    var out = { subscribers: null, videos: null, views_text: '', joined_text: '' }
    var sub = /([\d.,]+\s*(?:K|M|B|mil|millones?)?)\s*(?:suscriptores|subscribers)/i.exec(text)
    if (sub) out.subscribers = this._parseCompactNumber(sub[1])
    var folded = this._fold(text)
    var videos = /([\d.,]+\s*(?:K|M|B|mil|millones?)?)\s*(?:videos)/i.exec(folded)
    if (videos) out.videos = this._parseCompactNumber(videos[1])
    var views = /([\d.,]+\s*(?:K|M|B|mil|millones?)?)\s*(?:visualizaciones|views)/i.exec(text)
    if (views) out.views_text = views[0]
    var joined = /(?:se unio|joined)\s+([^\n]+)/i.exec(folded)
    if (joined) out.joined_text = joined[0]
    return out
  },

  _dateText: function (text) {
    var m = /(?:\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}|Premiered\s+[^\n]+|Publicado\s+[^\n]+)/i.exec(text || '')
    return m ? this._clean(m[0]) : ''
  },

  _likeText: function (doc) {
    var candidates = Array.prototype.slice.call(doc.querySelectorAll(
      'segmented-like-dislike-button-view-model button[aria-label], ytd-segmented-like-dislike-button-renderer button[aria-label], button[aria-label]'
    ))
    for (var i = 0; i < candidates.length; i++) {
      var label = candidates[i].getAttribute('aria-label') || ''
      if (/(me gusta|like)/i.test(label) && !/(no me gusta|dislike)/i.test(label)) return this._clean(label)
    }
    return ''
  },

  _hashtags: function (text) {
    var tags = {}
    ;(String(text || '').match(/#[\p{L}\p{N}_-]+/gu) || []).forEach(function (tag) { tags[tag] = true })
    return Object.keys(tags).slice(0, 30)
  },

  _verified: function (root) {
    var text = this._visibleText(root)
    if (/(verificado|verified)/i.test(text)) return true
    return !!(root && root.querySelector && root.querySelector('[aria-label*="Verificado"], [aria-label*="Verified"]'))
  },

  _parseCompactNumber: function (value) {
    value = this._clean(value)
    if (!value) return null
    var m = /([\d.,]+)\s*(K|M|B|mil|millones?)?/i.exec(value)
    if (!m) return null
    var raw = m[1]
    var suffix = (m[2] || '').toLowerCase()
    var normalized = raw
    if (raw.indexOf(',') !== -1 && raw.indexOf('.') !== -1) {
      normalized = raw.lastIndexOf(',') > raw.lastIndexOf('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '')
    } else if (raw.indexOf(',') !== -1) {
      var commaParts = raw.split(',')
      normalized = (!suffix && commaParts.length === 2 && commaParts[1].length === 3)
        ? raw.replace(/,/g, '')
        : raw.replace(',', '.')
    } else if ((raw.match(/\./g) || []).length > 1) {
      normalized = raw.replace(/\./g, '')
    } else if (raw.indexOf('.') !== -1) {
      var dotParts = raw.split('.')
      normalized = (!suffix && dotParts.length === 2 && dotParts[1].length === 3)
        ? raw.replace(/\./g, '')
        : raw
    }
    var n = Number(normalized)
    if (!isFinite(n)) return null
    var multiplier = 1
    if (suffix === 'k' || suffix === 'mil') multiplier = 1000
    if (suffix === 'm' || suffix.indexOf('millon') === 0) multiplier = 1000000
    if (suffix === 'b') multiplier = 1000000000
    return Math.round(n * multiplier)
  },

  _text: function (value) {
    if (!value) return ''
    if (typeof value === 'string' || typeof value === 'number') return this._clean(value)
    if (Array.isArray(value)) return this._clean(value.map(this._text.bind(this)).join(' '))
    if (value.simpleText) return this._clean(value.simpleText)
    if (value.text) return this._clean(value.text)
    if (value.content) return this._clean(value.content)
    if (value.accessibility && value.accessibility.accessibilityData) return this._clean(value.accessibility.accessibilityData.label)
    if (value.runs) return this._clean(value.runs.map(function (run) { return run.text || '' }).join(''))
    return ''
  },

  _thumb: function (value) {
    var thumbs = value && value.thumbnails || value && value.sources || []
    if (!Array.isArray(thumbs) || !thumbs.length) return ''
    var best = thumbs.slice().sort(function (a, b) {
      return ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0))
    })[0]
    return best && (best.url || best.uri) || ''
  },

  _meta: function (doc, attr, value) {
    var el = doc.querySelector('meta[' + attr + '="' + value + '"]')
    return this._clean(el && (el.content || el.getAttribute('content')))
  },

  _firstText: function (selectors, root) {
    root = root || document
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i])
      var text = this._visibleText(el)
      if (text) return this._clean(text.split('\n')[0])
    }
    return ''
  },

  _firstMatchingText: function (root, pattern) {
    if (!root) return ''
    var nodes = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('span, yt-formatted-string, div, a, button') : [])
    for (var i = 0; i < nodes.length; i++) {
      var text = this._clean(nodes[i].textContent)
      if (text.length > 140) continue
      if (text && (pattern.test(text) || pattern.test(this._fold(text)))) return text
    }
    return ''
  },

  _imageSrc: function (selectors, root) {
    root = root || document
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i])
      var src = el && (el.currentSrc || el.src || el.getAttribute('src'))
      if (src) return src
    }
    return ''
  },

  _visibleText: function (el) {
    if (!el) return ''
    return this._clean((el.innerText || el.textContent || '').replace(/\r/g, '\n'))
  },

  _clean: function (value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim()
  },

  _fold: function (value) {
    return this._clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  },

  _merge: function (base, patch) {
    var out = {}
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k] })
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') out[k] = patch[k]
    })
    return out
  },

  _appendSource: function (existing, source) {
    if (!source) return existing || null
    var parts = String(existing || '').split(',').map(function (p) { return p.trim() }).filter(Boolean)
    if (parts.indexOf(source) === -1) parts.push(source)
    return parts.join(', ')
  },

  _add: function (item) {
    if (!item) return
    var key = item._type + ':' + (item.id || item.username || item.url || item.display_name || '')
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
  },

  _requestPageData: function (delayMs) {
    try { window.postMessage({ __narsil_cmd: 'EXTRACT_PAGE_DATA' }, '*') } catch (_) {}
    return new Promise(function (resolve) { setTimeout(resolve, delayMs || 350) })
  },

  _sendDownload: function (filename, content, mimeType) {
    var safe = this._safeName(filename || 'youtube_report.txt')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('YouTube: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('YouTube: error de descarga - ' + e.message, 'err')
      })
  },

  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = this._safeName(filename || 'youtube_export.xlsx')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType })
      .catch(function (e) { NarsilPanel && NarsilPanel.log('YouTube: error de descarga - ' + e.message, 'err') })
  },

  _safeName: function (value) {
    return String(value || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
  },

  _addLine: function (lines, label, value) {
    if (value === undefined || value === null || value === '') return
    lines.push(label + ': ' + value)
  },

  _addBlock: function (lines, label, value) {
    if (!value) return
    lines.push('', label + ':', value)
  },
}
