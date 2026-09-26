// NARSIL Intel Collector - modules/linkedin.js
// Conservative LinkedIn collector. Active extraction reads the visible profile
// DOM and may enrich it with passive Voyager responses already loaded by the page.
'use strict'

NarsilModules.linkedin = {
  network:       'linkedin',
  collected:     [],
  _seen:         {},
  _profileCache: {},

  getPageType: function () {
    var p = location.pathname || '/'
    if (/^\/in\/[^/]+\/?/.test(p)) return 'profile'
    if (/^\/company\/[^/]+\/?/.test(p)) return 'company'
    if (/^\/mynetwork\//.test(p)) return 'network'
    if (/^\/feed\/|^\/posts\//.test(p)) return 'feed'
    return 'other'
  },

  getActions: function () {
    var type = this.getPageType()
    if (type === 'profile') return [{ id: 'profile_report', label: 'Reporte del perfil (TXT)' }]
    return []
  },

  runAction: function (id) {
    switch (id) {
      case 'profile_report': this._actionProfileReport(); break
    }
  },

  stats: function () {
    var p = 0
    this.collected.forEach(function (item) {
      if (item._type === 'profile') p++
    })
    return { profiles: p, posts: 0, contacts: 0 }
  },

  getItems: function () { return this.collected },

  clear: function () {
    this.collected = []
    this._seen = {}
    this._profileCache = {}
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  onPageData: function () {},

  onNetworkRequest: function (url, body) {
    try {
      if (!body || typeof body !== 'object') return
      url = String(url || '')
      if (!/linkedin\.com/i.test(url) && !/voyager\/api/i.test(url)) return

      if (/voyager\/api\/identity\/dash\/profiles/i.test(url)) {
        this._parseProfilePayload(body, 'voyager_profiles')
      }
    } catch (e) {
      NarsilPanel && NarsilPanel.log('LinkedIn: error procesando cache pasiva - ' + e.message, 'err')
    }
  },

  _actionProfileReport: function () {
    var self = this
    if (this.getPageType() !== 'profile') {
      NarsilPanel && NarsilPanel.log('LinkedIn: abre manualmente un perfil /in/... primero.', 'err')
      return
    }

    NarsilPanel && NarsilPanel.log('LinkedIn: preparando reporte del perfil...')
    this._requestPageData(450).then(function () {
      var profile = self._extractProfile(document)
      if (!profile.username && !profile.display_name) {
        NarsilPanel && NarsilPanel.log('LinkedIn: no se pudo extraer el perfil visible.', 'err')
        return
      }
      self._add(self._profileToSchema(profile))
      self._sendDownload(
        (profile.username || self._safeName(profile.display_name) || 'linkedin_profile') + '_linkedin_profile.txt',
        self._profileToText(profile),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('LinkedIn: reporte descargado para ' + (profile.display_name || profile.username) + '.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('LinkedIn: error - ' + e.message, 'err')
    })
  },

  // --------------------------------------------------------------------------
  // Passive cache
  // --------------------------------------------------------------------------

  _parseProfilePayload: function (body, source) {
    var elements = this._profileCandidatesFromPayload(body)
    var self = this
    elements.forEach(function (item) { self._cacheProfile(self._normalizeVoyagerProfile(item, source)) })
  },

  _normalizeVoyagerProfile: function (p, source) {
    if (!p || typeof p !== 'object') return null
    var firstName = this._localizedText(p.firstName)
    var lastName = this._localizedText(p.lastName)
    var name = this._clean([firstName, lastName].filter(Boolean).join(' ')) ||
      this._localizedText(p.fullName || p.name)
    var username = this._clean(p.publicIdentifier || p.publicIdentifierForUrl || p.vanityName)
    var followerCount = p.followingInfo && p.followingInfo.followerCount
    var connectionCount = p.connectionCount || p.connectionsCount
    return {
      id: this._clean(p.entityUrn || p.memberUrn || p.objectUrn || p.backendUrn || username),
      username: username,
      display_name: name,
      headline: this._localizedText(p.headline || p.occupation),
      location: this._localizedText(p.geoLocationName || p.locationName),
      industry: this._localizedText(p.industryName),
      avatar_url: this._vectorImageUrl(p.profilePicture) ||
        this._vectorImageUrl(p.profilePictureDisplayImage) ||
        this._vectorImageUrl(p.picture),
      followers: followerCount != null ? Number(followerCount) : null,
      connections: connectionCount != null ? Number(connectionCount) : null,
      profile_url: username ? 'https://www.linkedin.com/in/' + username + '/' : '',
      source: source,
    }
  },

  _profileCandidatesFromPayload: function (body) {
    var out = []
    var seen = {}
    var self = this
    var visit = function (node, depth) {
      if (!node || depth > 8) return
      if (Array.isArray(node)) {
        node.forEach(function (item) { visit(item, depth + 1) })
        return
      }
      if (typeof node !== 'object') return
      if (self._looksLikeLinkedInProfile(node)) {
        var key = node.entityUrn || node.memberUrn || node.objectUrn || node.backendUrn ||
          node.publicIdentifier || node.publicIdentifierForUrl || node.vanityName ||
          JSON.stringify(node).slice(0, 160)
        if (!seen[key]) {
          seen[key] = true
          out.push(node)
        }
      }
      Object.keys(node).forEach(function (key) {
        if (key === 'trackingId' || key === 'trackingUrn') return
        visit(node[key], depth + 1)
      })
    }
    visit(body, 0)
    return out
  },

  _looksLikeLinkedInProfile: function (obj) {
    if (!obj || typeof obj !== 'object') return false
    var urn = String(obj.entityUrn || obj.memberUrn || obj.objectUrn || obj.backendUrn || '')
    var type = String(obj.$type || '')
    if (obj.publicIdentifier || obj.publicIdentifierForUrl || obj.vanityName) return true
    if (/fsd_profile|fs_miniProfile|miniProfile/i.test(urn)) return true
    if (/identity\.profile|MiniProfile/i.test(type)) return true
    return false
  },

  _cacheProfile: function (profile) {
    if (!profile) return null
    var keys = []
    if (profile.username) keys.push('u:' + profile.username.toLowerCase())
    if (profile.id) keys.push('id:' + profile.id)
    if (!keys.length) return profile
    var primary = keys[0]
    var prev = this._profileCache[primary] || {}
    var merged = this._merge(prev, profile)
    merged.source = this._appendSource(prev.source, profile.source)
    var cache = this._profileCache
    keys.forEach(function (key) { cache[key] = merged })
    return merged
  },

  _cachedProfile: function (username) {
    username = this._clean(username || '').replace(/\/$/, '').toLowerCase()
    return username ? (this._profileCache['u:' + username] || {}) : {}
  },

  // --------------------------------------------------------------------------
  // DOM extraction
  // --------------------------------------------------------------------------

  _extractProfile: function (doc) {
    var username = this._profileUsername()
    var cached = this._cachedProfile(username)
    var top = doc.querySelector('main section') || doc.querySelector('main') || doc.body
    var name = this._firstText([
      'main h1.text-heading-xlarge',
      'main h1',
      '[data-generated-suggestion-target] h1',
    ], top)
    var headline = this._firstText([
      '.text-body-medium.break-words',
      '[data-field="headline"]',
      'main section div.text-body-medium',
    ], top)
    var profileLocation = this._firstText([
      '.text-body-small.inline.t-black--light.break-words',
      '[data-field="location"]',
    ], top)
    var canonical = doc.querySelector('link[rel="canonical"]')
    var profileUrl = (canonical && canonical.href) ||
      (username ? 'https://www.linkedin.com/in/' + username + '/' : window.location.href)
    var avatar = this._imageSrc([
      '.pv-top-card-profile-picture img',
      'img.profile-photo-edit__preview',
      'main img[src*="profile-displayphoto"]',
      'main img[src*="media.licdn.com"]',
    ], top)
    var banner = this._imageSrc([
      '.profile-background-image img',
      'img.profile-background-image',
      'main img[src*="profile-background"]',
      'main img[src*="background"]',
    ], top)
    var visibleText = this._visibleText(doc.querySelector('main') || doc.body)
    var counts = this._extractCounts(visibleText)

    var profile = {
      id: cached.id || null,
      username: username || cached.username || null,
      display_name: name || cached.display_name || null,
      headline: headline || cached.headline || null,
      location: profileLocation || cached.location || null,
      industry: cached.industry || null,
      profile_url: profileUrl || cached.profile_url || null,
      avatar_url: avatar || cached.avatar_url || null,
      banner_url: banner || null,
      followers: counts.followers != null ? counts.followers : cached.followers,
      connections: counts.connections != null ? counts.connections : cached.connections,
      degree: this._connectionDegree(visibleText),
      about: this._sectionText(doc, ['acerca de', 'about']),
      experience: this._sectionText(doc, ['experiencia', 'experience']),
      education: this._sectionText(doc, ['educacion', 'educación', 'education']),
      certifications: this._sectionText(doc, ['licencias y certificaciones', 'licenses & certifications', 'licenses and certifications']),
      skills: this._sectionText(doc, ['conocimientos y aptitudes', 'skills']),
      languages: this._sectionText(doc, ['idiomas', 'languages']),
      contact_links: this._contactLinks(doc),
      source: cached.source ? 'dom_profile,' + cached.source : 'dom_profile',
      warnings: [],
    }
    if (!profile.id) profile.warnings.push('profile_id_not_found_passive_cache')
    if (!profile.about) profile.warnings.push('about_not_visible')
    return profile
  },

  _profileUsername: function () {
    var canonical = document.querySelector('link[rel="canonical"]')
    var href = canonical && canonical.href || location.href
    var m = /linkedin\.com\/in\/([^/?#]+)/i.exec(href)
    return m ? decodeURIComponent(m[1]).replace(/\/$/, '') : ''
  },

  _sectionText: function (doc, labels) {
    var sections = Array.prototype.slice.call(doc.querySelectorAll('main section'))
    var self = this
    var normalizedLabels = labels.map(function (label) { return self._normalizeText(label) })
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i]
      var heading = this._sectionHeading(section)
      var all = this._normalizeText(this._visibleText(section)).slice(0, 250)
      var hit = normalizedLabels.some(function (label) {
        return heading.indexOf(label) !== -1 || all.indexOf(label) === 0 || all.indexOf(label + ' ') !== -1
      })
      if (!hit) continue
      return this._cleanSectionText(section, normalizedLabels)
    }
    return ''
  },

  _sectionHeading: function (section) {
    var h = section.querySelector('h2, h3')
    return this._normalizeText(this._visibleText(h || section).split('\n')[0] || '')
  },

  _cleanSectionText: function (section, labels) {
    var lines = this._visibleText(section).split(/\n+/).map(this._clean).filter(Boolean)
    var out = []
    var seen = {}
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      var normalized = this._normalizeText(line)
      if (!normalized) continue
      if (labels.indexOf(normalized) !== -1) continue
      if (/^(mostrar|show|ver|see)\b/i.test(line)) continue
      if (/^(activar|activate|siguiendo|following)$/i.test(line)) continue
      if (seen[normalized]) continue
      seen[normalized] = true
      out.push(line)
      if (out.join('\n').length > 2200) break
    }
    return out.join('\n')
  },

  _extractCounts: function (text) {
    var out = { followers: null, connections: null }
    var followers = /([\d.,]+)\s*(?:seguidores|followers)/i.exec(text)
    if (followers) out.followers = this._parseNumber(followers[1])
    var connections = /([\d.,]+)\s*(?:contactos|connections?)/i.exec(text)
    if (connections) out.connections = this._parseNumber(connections[1])
    return out
  },

  _connectionDegree: function (text) {
    var m = /\b(1\.?er|1st|2\.?o|2nd|3\.?er|3rd)\b(?:\s*(?:grado|degree))?/i.exec(text || '')
    return m ? m[0] : ''
  },

  _contactLinks: function (doc) {
    var out = []
    var seen = {}
    Array.prototype.slice.call(doc.querySelectorAll('main a[href], [role="dialog"] a[href]')).forEach(function (a) {
      var href = a.href || a.getAttribute('href') || ''
      if (!href) return
      if (/linkedin\.com\/(?:in|company|feed|mynetwork|jobs|learning|sales|notifications|messaging)\//i.test(href)) return
      if (!/^(https?:|mailto:|tel:)/i.test(href)) return
      if (seen[href]) return
      seen[href] = true
      out.push({ href: href, text: (a.textContent || '').replace(/\s+/g, ' ').trim() })
    })
    return out.slice(0, 12)
  },

  // --------------------------------------------------------------------------
  // Output
  // --------------------------------------------------------------------------

  _profileToSchema: function (p) {
    return NarsilSchema.profile('linkedin', {
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      bio: p.headline || p.about,
      avatar_url: p.avatar_url,
      followers: p.followers,
      url: p.profile_url,
      location: p.location,
      network_specific: {
        source: p.source,
        headline: p.headline,
        industry: p.industry,
        connections: p.connections,
        degree: p.degree,
        banner_url: p.banner_url,
        about: p.about,
        experience: p.experience,
        education: p.education,
        certifications: p.certifications,
        skills: p.skills,
        languages: p.languages,
        contact_links: p.contact_links,
        warnings: p.warnings,
      },
    })
  },

  _profileToText: function (p) {
    var lines = ['LinkedIn profile report', 'Captured: ' + new Date().toISOString(), 'URL: ' + (p.profile_url || location.href), '']
    this._addLine(lines, 'Profile ID', p.id)
    this._addLine(lines, 'Public identifier', p.username)
    this._addLine(lines, 'Name', p.display_name)
    this._addLine(lines, 'Headline', p.headline)
    this._addLine(lines, 'Location', p.location)
    this._addLine(lines, 'Industry', p.industry)
    this._addLine(lines, 'Followers', p.followers)
    this._addLine(lines, 'Connections', p.connections)
    this._addLine(lines, 'Connection degree', p.degree)
    this._addLine(lines, 'Avatar URL', p.avatar_url)
    this._addLine(lines, 'Banner URL', p.banner_url)
    this._addBlock(lines, 'About', p.about)
    this._addBlock(lines, 'Experience', p.experience)
    this._addBlock(lines, 'Education', p.education)
    this._addBlock(lines, 'Licenses and certifications', p.certifications)
    this._addBlock(lines, 'Skills', p.skills)
    this._addBlock(lines, 'Languages', p.languages)
    if (p.contact_links && p.contact_links.length) {
      this._addBlock(lines, 'Visible external/contact links', p.contact_links.map(function (l) {
        return l.text ? l.text + ' <' + l.href + '>' : l.href
      }).join('\n'))
    }
    if (p.warnings && p.warnings.length) this._addLine(lines, 'Warnings', p.warnings.join(', '))
    return lines.join('\n')
  },

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

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
    var safe = this._safeName(filename || 'linkedin_profile.txt')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('LinkedIn: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('LinkedIn: error de descarga - ' + e.message, 'err')
      })
  },

  _vectorImageUrl: function (obj) {
    if (typeof obj === 'string') return obj
    if (!obj || typeof obj !== 'object') return ''
    var vector = obj.vectorImage ||
      (obj.rootUrl && obj.artifacts ? obj : null) ||
      obj.displayImageReference && obj.displayImageReference.vectorImage ||
      obj.displayImageReferenceResolutionResult && obj.displayImageReferenceResolutionResult.vectorImage
    if (!vector) return ''
    var root = vector.rootUrl || ''
    var artifacts = vector.artifacts || []
    if (!root && vector.url) return vector.url
    if (!artifacts.length) return root
    var best = artifacts.slice().sort(function (a, b) {
      return ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0))
    })[0]
    return root + (best.fileIdentifyingUrlPathSegment || '')
  },

  _localizedText: function (value) {
    if (!value) return ''
    if (typeof value === 'string' || typeof value === 'number') return this._clean(value)
    if (typeof value !== 'object') return ''
    if (value.text) return this._clean(value.text)
    if (value.preferredLocale && value.localized) {
      var key = [value.preferredLocale.language, value.preferredLocale.country].filter(Boolean).join('_')
      if (key && value.localized[key]) return this._clean(value.localized[key])
    }
    if (value.localized) {
      if (typeof value.localized === 'string') return this._clean(value.localized)
      var localizedKeys = Object.keys(value.localized)
      if (localizedKeys.length) return this._clean(value.localized[localizedKeys[0]])
    }
    return this._clean(value.name || value.value || '')
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

  _normalizeText: function (value) {
    return this._clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  },

  _parseNumber: function (value) {
    if (value == null) return null
    var n = String(value).replace(/[^\d]/g, '')
    return n ? Number(n) : null
  },

  _safeName: function (value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 120)
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

  _addLine: function (lines, label, value) {
    if (value === undefined || value === null || value === '') return
    lines.push(label + ': ' + value)
  },

  _addBlock: function (lines, label, value) {
    if (!value) return
    lines.push('', label + ':', value)
  },
}
