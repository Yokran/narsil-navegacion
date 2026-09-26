// NARSIL Intel Collector - modules/matrix.js
// Conservative Matrix / Element collector. Active actions read only the visible
// DOM already loaded by the operator; no session secrets or authenticated API.
'use strict'

NarsilModules.matrix = {
  network: 'matrix',
  collected: [],
  _seen: {},
  _roomsByKey: {},
  _membersByKey: {},
  _messagesByKey: {},

  getPageType: function () {
    if (this._isLoginView(document)) return 'login'
    if (this._hasMemberPanel(document)) return 'room_info'
    if (this._hasRoom(document)) return 'room'
    return 'unknown'
  },

  getActions: function () {
    var type = this.getPageType()
    if (type === 'login') return [{ id: 'blocked', label: 'Sesion no iniciada' }]
    var actions = []
    if (type === 'room' || type === 'room_info') {
      actions.push({ id: 'room_report', label: 'Reporte de la sala (TXT)' })
      if (type === 'room_info') actions.push({ id: 'visible_members', label: 'Miembros visibles -> XLSX' })
      actions.push({ id: 'visible_messages', label: 'Mensajes visibles -> XLSX' })
    }
    if (Object.keys(this._membersByKey).length || this._contactItems().length) {
      actions.push({ id: 'captured_contacts', label: 'Contactos capturados -> XLSX' })
    }
    return actions
  },

  runAction: function (id) {
    switch (id) {
      case 'room_report':       this._actionRoomReport(); break
      case 'visible_members':   this._actionVisibleMembers(); break
      case 'visible_messages':  this._actionVisibleMessages(); break
      case 'captured_contacts': this._actionCapturedContacts(); break
      case 'blocked':
        NarsilPanel && NarsilPanel.log('Matrix: inicia sesion manualmente antes de extraer datos.', 'err')
        break
    }
  },

  stats: function () {
    var profiles = 0
    var posts = 0
    var contacts = 0
    this.collected.forEach(function (item) {
      if (item._type === 'profile' || item._type === 'group') profiles++
      else if (item._type === 'post') posts++
      else if (item._type === 'contact') contacts++
    })
    return { profiles: profiles, posts: posts, contacts: contacts }
  },

  getItems: function () { return this.collected },

  clear: function () {
    this.collected = []
    this._seen = {}
    this._roomsByKey = {}
    this._membersByKey = {}
    this._messagesByKey = {}
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  onPageData: function () {},

  onNetworkRequest: function () {},

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  _actionRoomReport: function () {
    try {
      var room = this._extractRoom(document)
      if (!room.name && !room.id && !room.alias) {
        NarsilPanel && NarsilPanel.log('Matrix: no se pudo identificar la sala visible.', 'err')
        return
      }
      var members = this._extractMembers(document, room)
      var messages = this._extractMessages(document, room)
      this._rememberRoom(room, members)
      this._sendDownload(
        'matrix_sala_' + this._safeName(room.alias || room.id || room.name || 'visible') + '.txt',
        this._roomToText(room, members, messages),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('Matrix: reporte de sala descargado.', 'ok')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('Matrix: error preparando reporte - ' + e.message, 'err')
    }
  },

  _actionVisibleMembers: function () {
    var self = this
    var room = this._extractRoom(document)
    var panel = this._findMemberPanel(document)
    if (!panel) {
      NarsilPanel && NarsilPanel.log('Matrix: abre manualmente el panel de miembros de la sala.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('Matrix: recorriendo lista visible de miembros...')
    this._scanMembers(panel, room).then(function (scan) {
      var rows = self._memberRows(room.name)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Matrix: no hay miembros visibles capturados. Asegurate de tener abierto el panel de miembros.', 'err')
        return
      }
      self._downloadRows('matrix_miembros_' + self._safeName(room.alias || room.id || room.name || 'sala'), rows)
      var detail = scan && scan.steps ? ' en ' + scan.steps + ' pasos' : ''
      NarsilPanel && NarsilPanel.log('Matrix: ' + rows.length + ' miembros exportados' + detail + '.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('Matrix: error extrayendo miembros - ' + e.message, 'err')
    })
  },

  _actionVisibleMessages: function () {
    try {
      var room = this._extractRoom(document)
      var messages = this._extractMessages(document, room)
      var rows = this._messageRows(messages, room)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Matrix: no hay mensajes visibles para exportar.', 'err')
        return
      }
      this._downloadRows('matrix_mensajes_' + this._safeName(room.alias || room.id || room.name || 'sala'), rows)
      NarsilPanel && NarsilPanel.log('Matrix: ' + rows.length + ' mensajes visibles exportados.', 'ok')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('Matrix: error extrayendo mensajes - ' + e.message, 'err')
    }
  },

  _actionCapturedContacts: function () {
    var rows = this._memberRows()
    if (!rows.length) rows = this._contactItems().map(this._contactItemToRow.bind(this))
    if (!rows.length) {
      NarsilPanel && NarsilPanel.log('Matrix: no hay contactos capturados todavia.', 'err')
      return
    }
    this._downloadRows('matrix_contactos_capturados', rows)
    NarsilPanel && NarsilPanel.log('Matrix: ' + rows.length + ' contactos capturados exportados.', 'ok')
  },

  // --------------------------------------------------------------------------
  // DOM extraction
  // --------------------------------------------------------------------------

  _extractRoom: function (doc) {
    var panel = this._findMemberPanel(doc)
    var header = this._roomHeader(doc)
    var name = this._firstText([
      '.mx_RoomHeader_name',
      '.mx_RoomHeader_nametext',
      '[class*="RoomHeader"] [class*="name"]',
      '[class*="room-header"] [class*="name"]',
      'header h1',
      'header [dir="auto"]',
    ], doc)
    if (!name && header) name = this._bestHeaderTitle(header)

    var subtitle = this._firstText([
      '.mx_RoomHeader_topic',
      '.mx_RoomHeader_subtitle',
      '[class*="RoomHeader"] [class*="topic"]',
      '[class*="RoomHeader"] [class*="subtitle"]',
      'header [class*="topic"]',
      'header [class*="subtitle"]',
    ], doc)

    var id = this._roomIdFromDom(doc) || this._roomIdFromUrl()
    var alias = this._roomAliasFromDom(panel || doc) || this._roomAliasFromUrl()
    var panelText = this._visibleText(panel)
    var description = panel ? this._firstLongText(panel, name) : ''
    var memberCount = this._memberCount(subtitle || panelText)
    var avatar = this._imageSrc([
      '.mx_RoomAvatar img',
      '[class*="RoomAvatar"] img',
      '.mx_RightPanel img',
      '[class*="RightPanel"] img',
      'header img',
    ], doc)
    var type = this._roomType(name, subtitle, panelText, memberCount)
    return {
      id: this._clean(id),
      alias: this._clean(alias),
      name: this._clean(name),
      type: type,
      subtitle: this._clean(subtitle),
      description: this._clean(description),
      member_count: memberCount,
      avatar_url: avatar,
      url: alias || id ? 'https://matrix.to/#/' + encodeURIComponent(alias || id) : location.href,
      captured_at: new Date().toISOString(),
    }
  },

  _extractMembers: function (doc, room) {
    room = room || this._extractRoom(doc)
    var panel = this._findMemberPanel(doc)
    if (!panel) return []
    var out = []
    var seen = {}
    var self = this
    this._memberNodes(panel).forEach(function (node) {
      var member = self._memberFromNode(node, room)
      if (!member) return
      var key = self._memberKey(member)
      if (seen[key]) return
      seen[key] = true
      self._rememberMember(member)
      out.push(member)
    })
    return out
  },

  _extractMessages: function (doc, room) {
    room = room || this._extractRoom(doc)
    var out = []
    var seen = {}
    var self = this
    this._messageNodes(doc).forEach(function (node, idx) {
      var msg = self._messageFromNode(node, room, idx)
      if (!msg) return
      var key = msg.id || [room.name, msg.sender_id, msg.sender_name, msg.time, msg.text].join('|')
      if (seen[key]) return
      seen[key] = true
      self._rememberMessage(msg)
      self._add(NarsilSchema.post('matrix', {
        id: msg.id,
        author_id: msg.sender_id,
        author_username: msg.sender_name || msg.sender_id,
        content: msg.text,
        media_urls: msg.media_urls,
        published_at: msg.date || msg.time || null,
        url: location.href,
        network_specific: {
          room_id: room.id,
          room_alias: room.alias,
          room_name: room.name,
          media_types: msg.media_types,
          links: msg.links,
          source: 'dom_visible_message',
        },
      }))
      out.push(msg)
    })
    return out
  },

  _isLoginView: function (doc) {
    return !!doc.querySelector('.mx_AuthPage, [class*="AuthPage"], input[name="username"], input[type="password"]')
  },

  _hasRoom: function (doc) {
    return !!(this._roomHeader(doc) || this._messageNodes(doc).length || /#\/room\//i.test(location.hash || ''))
  },

  _hasMemberPanel: function (doc) {
    var panel = this._findMemberPanel(doc)
    return !!(panel && (this._memberNodes(panel).length || /(miembros|members|personas|people|usuarios|users)/i.test(this._visibleText(panel))))
  },

  _roomHeader: function (doc) {
    return doc.querySelector('.mx_RoomHeader, [class*="RoomHeader"], header')
  },

  _findMemberPanel: function (doc) {
    var selectors = [
      '.mx_RightPanel',
      '.mx_MemberList',
      '.mx_MemberInfo',
      '.mx_UserInfo',
      '.mx_BaseCard',
      '[class*="RightPanel"]',
      '[class*="MemberList"]',
      '[class*="MemberInfo"]',
      '[class*="UserInfo"]',
      '[class*="RoomSummary"]',
      '[aria-label*="member" i]',
      '[aria-label*="miembro" i]',
      'aside',
    ]
    var candidates = []
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(doc.querySelectorAll(selector)).forEach(function (node) {
        if (candidates.indexOf(node) === -1) candidates.push(node)
      })
    })
    var self = this
    var scored = candidates.map(function (node) {
      return { node: node, score: self._scoreMemberPanel(node) }
    }).filter(function (entry) {
      return entry.score > 0
    }).sort(function (a, b) {
      return b.score - a.score
    })
    return scored.length ? scored[0].node : null
  },

  _scoreMemberPanel: function (node) {
    if (!node || !node.querySelectorAll) return 0
    var text = this._visibleText(node)
    var attr = [
      node.getAttribute && node.getAttribute('class'),
      node.getAttribute && node.getAttribute('aria-label'),
    ].filter(Boolean).join(' ')
    var hasMemberText = /(miembros|members|personas|people|usuarios|users|admins|administradores)/i.test(text)
    var hasInfoAttr = /(RightPanel|MemberList|MemberInfo|UserInfo|RoomSummary|BaseCard|right-panel|member-list|member-info|user-info)/i.test(attr)
    var isRightPanel = false
    try {
      var rect = node.getBoundingClientRect()
      isRightPanel = rect.left > window.innerWidth * 0.35
    } catch (_) {}
    if (!hasMemberText && !hasInfoAttr && !isRightPanel) return 0
    var score = 0
    if (hasInfoAttr) score += 12
    if (hasMemberText) score += 24
    score += Math.min(this._memberNodes(node).length * 5, 35)
    if (this._isScrollable(node)) score += 5
    try {
      var r = node.getBoundingClientRect()
      if (r.width >= 220 && r.width <= 620) score += 4
      if (r.left > window.innerWidth * 0.35) score += 8
      if (r.height > 280) score += 2
    } catch (_) {}
    return score
  },

  _memberNodes: function (root) {
    if (!root || !root.querySelectorAll) return []
    var selectors = [
      '.mx_EntityTile',
      '.mx_MemberTile',
      '.mx_UserTile',
      '[class*="EntityTile"]',
      '[class*="MemberTile"]',
      '[class*="UserTile"]',
      '[role="listitem"]',
      '[data-user-id]',
      '[data-member-id]',
      'a[href*="matrix.to/#/@"]',
    ]
    var nodes = []
    var self = this
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(root.querySelectorAll(selector)).forEach(function (node) {
        var item = self._memberContainer(node)
        if (item && nodes.indexOf(item) === -1 && self._looksLikeMemberNode(item)) nodes.push(item)
      })
    })
    return nodes
  },

  _memberContainer: function (node) {
    if (!node) return null
    var exact = '.mx_EntityTile, .mx_MemberTile, .mx_UserTile, [role="listitem"], [data-user-id], [data-member-id]'
    if (node.matches && node.matches(exact)) return node
    var closest = node.closest && node.closest(exact)
    if (closest) return closest
    var cls = String(node.className || '')
    if (/(^|\s)(mx_)?(EntityTile|MemberTile|UserTile)(\s|$)/i.test(cls) && !/(name|details|subtext|presence|avatar)/i.test(cls)) return node
    return null
  },

  _looksLikeMemberNode: function (node) {
    var text = this._clean(node && node.textContent)
    if (!text || text.length > 500) return false
    if (node.closest && node.closest('.mx_RoomView_MessageList, [class*="MessageList"], [class*="TimelinePanel"], [data-event-id]')) return false
    if (this._matrixUserIdFromText(text)) return true
    if (node.querySelector && node.querySelector('[class*="name" i], img, a[href*="matrix.to/#/@"], [data-user-id], [data-member-id]')) return true
    return /(online|offline|away|ausente|activo|admin|moderator|mod)/i.test(text)
  },

  _memberFromNode: function (node, room) {
    var id = this._userIdFromNode(node)
    var name = this._memberName(node, id)
    var status = this._memberStatus(node, name, id)
    var role = this._memberRole(node.textContent || '')
    var avatar = this._imageSrc(['img'], node)
    if (!id && !name) return null
    return {
      id: id,
      name: name || id,
      status: status,
      role: role,
      room: room && room.name || '',
      room_id: room && room.id || '',
      room_alias: room && room.alias || '',
      avatar_url: avatar,
      source: 'dom_visible_member',
    }
  },

  _memberName: function (node, id) {
    var selectors = [
      '.mx_EntityTile_name',
      '.mx_DisambiguatedProfile_displayName',
      '[class*="EntityTile_name"]',
      '[class*="displayName"]',
      '[class*="name" i]',
      '[dir="auto"]',
    ]
    for (var i = 0; i < selectors.length; i++) {
      var el = node.querySelector && node.querySelector(selectors[i])
      var text = this._clean(el && (el.getAttribute && el.getAttribute('title') || el.innerText || el.textContent))
      if (text && text !== id && text.length < 140 && !this._matrixUserIdFromText(text)) return text
    }
    var first = this._clean((node.innerText || node.textContent || '').split('\n')[0])
    return first && first !== id && first.length < 140 && !this._matrixUserIdFromText(first) ? first : ''
  },

  _memberStatus: function (node, name, id) {
    var selectors = ['.mx_EntityTile_details', '.mx_EntityTile_subtext', '[class*="details" i]', '[class*="subtext" i]', '[class*="presence" i]']
    for (var i = 0; i < selectors.length; i++) {
      var el = node.querySelector && node.querySelector(selectors[i])
      var text = this._clean(el && (el.innerText || el.textContent))
      if (text && text !== name && text !== id && text.length < 180) return text
    }
    var lines = this._visibleText(node).split('\n').map(this._clean.bind(this)).filter(Boolean)
    for (var j = 0; j < lines.length; j++) {
      if (lines[j] !== name && lines[j] !== id && lines[j].length < 180) return lines[j]
    }
    return ''
  },

  _memberRole: function (text) {
    if (/(owner|creador|propietario)/i.test(text)) return 'owner'
    if (/(admin|administrador|moderator|moderador|mod\b)/i.test(text)) return 'admin'
    return 'member'
  },

  _messageNodes: function (doc) {
    var nodes = []
    function add(node) {
      if (node && nodes.indexOf(node) === -1) nodes.push(node)
    }
    var self = this
    Array.prototype.slice.call(doc.querySelectorAll('[data-event-id], .mx_EventTile, [class*="EventTile"]')).forEach(function (node) {
      add(self._messageContainer(node))
    })
    return nodes.filter(function (node) {
      if (node.closest && node.closest('.mx_RightPanel, [class*="RightPanel"], [class*="MemberList"], aside')) return false
      var text = (node.innerText || node.textContent || '').trim()
      return text || (node.querySelector && node.querySelector('img, video, audio, a[href]'))
    })
  },

  _messageContainer: function (node) {
    if (!node) return null
    if (node.matches && node.matches('[data-event-id], .mx_EventTile')) return node
    var closest = node.closest && node.closest('[data-event-id], .mx_EventTile')
    if (closest) return closest
    var cls = String(node.className || '')
    if (/(^|\s)(mx_)?EventTile(\s|$)/i.test(cls) && !/(sender|body|timestamp|avatar|content)/i.test(cls)) return node
    return null
  },

  _messageFromNode: function (node, room, idx) {
    var text = this._messageText(node)
    var media = this._messageMedia(node)
    var links = this._links(node)
    if (!text && !media.types.length && !links.length) return null
    var senderId = this._userIdFromNode(node)
    var senderName = this._messageSender(node, senderId)
    var id = this._clean(node.getAttribute && (
      node.getAttribute('data-event-id') ||
      node.getAttribute('data-id') ||
      node.getAttribute('id')
    ))
    if (!id) id = this._messageStableId(room, senderId || senderName, text, idx)
    return {
      id: id,
      sender_id: senderId,
      sender_name: senderName,
      date: this._messageDate(node),
      time: this._messageTime(node),
      text: text,
      media_types: media.types,
      media_urls: media.urls,
      links: links,
    }
  },

  _messageText: function (node) {
    var selectors = [
      '.mx_EventTile_body',
      '.mx_MTextBody',
      '[class*="EventTile_body"]',
      '[class*="MTextBody"]',
      '[class*="message-body" i]',
      '[class*="body" i] [dir]',
      '[dir="auto"]',
      '[dir="ltr"]',
    ]
    var parts = []
    var self = this
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(node.querySelectorAll ? node.querySelectorAll(selector) : []).forEach(function (el) {
        var text = self._clean(el.innerText || el.textContent)
        if (!text || parts.indexOf(text) !== -1) return
        if (self._looksLikeMessageMeta(text)) return
        parts.push(text)
      })
    })
    if (!parts.length) {
      var fallback = this._clean(node.innerText || node.textContent)
      if (fallback && fallback.length < 2000) parts.push(fallback)
    }
    return parts.join('\n')
  },

  _messageSender: function (node, senderId) {
    var sender = this._firstText([
      '.mx_EventTile_sender',
      '.mx_SenderProfile',
      '.mx_DisambiguatedProfile_displayName',
      '[class*="EventTile_sender"]',
      '[class*="SenderProfile"]',
      '[class*="sender" i]',
    ], node)
    if (sender && sender !== senderId) return sender
    return senderId || ''
  },

  _messageDate: function (node) {
    var timeEl = node.querySelector && node.querySelector('time[datetime]')
    if (timeEl) return this._clean(timeEl.getAttribute('datetime')).split('T')[0]
    var title = this._clean(timeEl && timeEl.getAttribute('title') || node.getAttribute && node.getAttribute('title'))
    var m = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.exec(title || this._clean(node.textContent))
    return m ? m[0] : ''
  },

  _messageTime: function (node) {
    var timeEl = node.querySelector && node.querySelector('time[datetime]')
    if (timeEl) {
      var dt = this._clean(timeEl.getAttribute('datetime'))
      var tm = /T(\d{1,2}:\d{2})/.exec(dt)
      if (tm) return tm[1]
    }
    var text = this._firstText(['.mx_MessageTimestamp', '[class*="MessageTimestamp"]', 'time', '[class*="time" i]'], node) || this._clean(node.textContent)
    var m = /\b\d{1,2}:\d{2}\b/.exec(text)
    return m ? m[0] : ''
  },

  _messageMedia: function (node) {
    var types = {}
    var urls = []
    function add(type) { if (type) types[type] = true }
    Array.prototype.slice.call(node.querySelectorAll ? node.querySelectorAll('img[src], video[src], audio[src], source[src]') : []).forEach(function (el) {
      var tag = (el.tagName || '').toLowerCase()
      if (tag === 'img') add('imagen')
      if (tag === 'video') add('video')
      if (tag === 'audio') add('audio')
      var src = el.currentSrc || el.src || el.getAttribute('src')
      if (src && urls.indexOf(src) === -1) urls.push(src)
    })
    var html = String(node.innerHTML || '')
    if (/document|archivo|file|attachment/i.test(html)) add('documento')
    if (/voice|audio/i.test(html)) add('audio')
    if (/sticker|gif/i.test(html)) add('sticker')
    return { types: Object.keys(types), urls: urls.slice(0, 10) }
  },

  // --------------------------------------------------------------------------
  // Scroll and row builders
  // --------------------------------------------------------------------------

  _scanMembers: async function (panel, room) {
    room = room || this._extractRoom(document)
    var container = this._memberScrollContainer(panel) || panel
    var steps = 0
    var idle = 0
    var prev = -1
    var maxSteps = 80
    var step = Math.max(260, Math.floor((container.clientHeight || 620) * 0.85))

    try { container.scrollTop = 0 } catch (_) {}
    this._extractMembers(document, room)
    await this._sleep(220)

    while (steps < maxSteps && idle < 12) {
      this._extractMembers(document, room)
      var count = this._memberRows(room.name).length
      if (count > prev) {
        prev = count
        idle = 0
      } else {
        idle++
      }
      if (steps === 0 || steps % 10 === 0) {
        NarsilPanel && NarsilPanel.log('Matrix: miembros detectados hasta ahora: ' + count)
      }
      var movement = this._driveScroll(container, step)
      steps++
      await this._sleep(180)
      if (!movement.moved && movement.atEnd && idle >= 3) break
    }
    this._extractMembers(document, room)
    return { steps: steps }
  },

  _memberScrollContainer: function (panel) {
    if (!panel) return null
    var candidates = [panel]
    Array.prototype.slice.call(panel.querySelectorAll ? panel.querySelectorAll('[role="list"], .mx_AutoHideScrollbar, [class*="scroll" i], [class*="List" i], div') : []).forEach(function (node) {
      candidates.push(node)
    })
    var self = this
    var scored = candidates.map(function (node) {
      var score = 0
      if (self._isScrollable(node)) score += 12
      score += Math.min(self._memberNodes(node).length * 3, 24)
      var text = self._visibleText(node).slice(0, 500)
      if (/(miembros|members|personas|people|usuarios|users)/i.test(text)) score += 6
      return { node: node, score: score }
    }).filter(function (entry) {
      return entry.score > 0
    }).sort(function (a, b) {
      return b.score - a.score
    })
    return scored.length ? scored[0].node : null
  },

  _driveScroll: function (container, delta) {
    var before = container.scrollTop || 0
    try {
      if (typeof container.scrollBy === 'function') container.scrollBy({ top: delta, left: 0, behavior: 'auto' })
    } catch (_) {}
    try { container.scrollTop = Math.max(0, Math.min(container.scrollHeight || 0, (container.scrollTop || 0) + delta)) } catch (_) {}
    try { container.dispatchEvent(new Event('scroll', { bubbles: true })) } catch (_) {}
    try { container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: delta, deltaMode: 0 })) } catch (_) {}
    var last = this._lastMemberNode(container)
    try {
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end', inline: 'nearest' })
    } catch (_) {}
    var after = container.scrollTop || 0
    return {
      moved: Math.abs(after - before) > 2,
      atEnd: (after + (container.clientHeight || 0)) >= ((container.scrollHeight || 0) - 6),
    }
  },

  _lastMemberNode: function (root) {
    var nodes = this._memberNodes(root)
    return nodes.length ? nodes[nodes.length - 1] : null
  },

  _memberRows: function (roomName) {
    var self = this
    return Object.keys(this._membersByKey).sort(function (a, b) {
      var ma = self._membersByKey[a]
      var mb = self._membersByKey[b]
      return String(ma.name || '').localeCompare(String(mb.name || ''))
    }).map(function (key) {
      return self._membersByKey[key]
    }).filter(function (m) {
      return !roomName || !m.room || m.room === roomName
    }).map(function (m) {
      return {
        'ID': m.id || NarsilExport.missing('id no visible'),
        'Nombre': m.name || NarsilExport.missing('nombre no visible'),
        'Estado': m.status || NarsilExport.missing('estado no visible'),
        'Rol': m.role || NarsilExport.missing(),
        'Sala': m.room || NarsilExport.missing('sala no capturada'),
        'Sala ID': m.room_id || NarsilExport.missing('id de sala no visible'),
        'Avatar': m.avatar_url || NarsilExport.missing(),
      }
    })
  },

  _messageRows: function (messages, room) {
    room = room || {}
    return (messages || []).map(function (m) {
      return {
        'Sala': room.name || NarsilExport.missing('sala no capturada'),
        'Remitente': m.sender_name || NarsilExport.missing('remitente no visible'),
        'ID remitente': m.sender_id || NarsilExport.missing('id no visible'),
        'Fecha': m.date || NarsilExport.missing('fecha no visible'),
        'Hora': m.time || NarsilExport.missing('hora no visible'),
        'Texto': m.text || NarsilExport.missing('sin texto visible'),
        'Multimedia': m.media_types && m.media_types.length ? m.media_types.join(', ') : NarsilExport.missing('sin media visible'),
        'Enlaces': m.links && m.links.length ? m.links.join(', ') : NarsilExport.missing('sin enlaces visibles'),
      }
    })
  },

  _contactItemToRow: function (item) {
    var ns = item.network_specific || {}
    return {
      'ID': item.id || NarsilExport.missing('id no visible'),
      'Nombre': item.display_name || item.username || NarsilExport.missing('nombre no visible'),
      'Estado': ns.status || NarsilExport.missing('estado no visible'),
      'Rol': item.role || NarsilExport.missing(),
      'Sala': ns.room || NarsilExport.missing('sala no capturada'),
      'Sala ID': ns.room_id || NarsilExport.missing('id de sala no visible'),
      'Avatar': item.avatar_url || NarsilExport.missing(),
    }
  },

  _roomToText: function (room, members, messages) {
    var lines = ['Matrix / Element room report', 'Captured: ' + room.captured_at, 'URL: ' + (room.url || location.href), '']
    this._addLine(lines, 'Type', room.type)
    this._addLine(lines, 'Room ID', room.id)
    this._addLine(lines, 'Alias', room.alias)
    this._addLine(lines, 'Name', room.name)
    this._addLine(lines, 'Subtitle', room.subtitle)
    this._addLine(lines, 'Member count text/parsed', room.member_count)
    this._addLine(lines, 'Avatar URL', room.avatar_url)
    this._addBlock(lines, 'Description', room.description)
    this._addLine(lines, 'Visible members extracted', members.length)
    this._addLine(lines, 'Visible messages extracted', messages.length)
    return lines.join('\n')
  },

  // --------------------------------------------------------------------------
  // Cache and schema helpers
  // --------------------------------------------------------------------------

  _rememberRoom: function (room, members) {
    if (!room) return null
    var key = room.id || room.alias || room.name
    if (!key) return null
    this._roomsByKey[key] = this._merge(this._roomsByKey[key] || {}, room)
    this._add(NarsilSchema.group('matrix', {
      id: room.id || room.alias || room.name,
      name: room.name,
      description: room.description,
      member_count: room.member_count || (members && members.length) || null,
      url: room.url,
      members: (members || []).map(function (m) { return m.id || m.name }).filter(Boolean),
      network_specific: {
        alias: room.alias,
        type: room.type,
        subtitle: room.subtitle,
        avatar_url: room.avatar_url,
        source: 'dom_visible_room',
      },
    }))
    return this._roomsByKey[key]
  },

  _rememberMember: function (member) {
    if (!member) return null
    var key = this._memberKey(member)
    var merged = this._merge(this._membersByKey[key] || {}, member)
    this._membersByKey[key] = merged
    this._add(NarsilSchema.contact('matrix', {
      id: merged.id || merged.name,
      display_name: merged.name,
      role: merged.role,
      avatar_url: merged.avatar_url,
      network_specific: {
        status: merged.status,
        room: merged.room,
        room_id: merged.room_id,
        room_alias: merged.room_alias,
        source: merged.source,
      },
    }))
    return merged
  },

  _rememberMessage: function (msg) {
    if (!msg) return null
    var key = msg.id || [msg.sender_id, msg.time, msg.text].join('|')
    this._messagesByKey[key] = this._merge(this._messagesByKey[key] || {}, msg)
    return this._messagesByKey[key]
  },

  _memberKey: function (member) {
    return [member.room_id || member.room || '', member.id || '', this._fold(member.name || '')].join(':')
  },

  _contactItems: function () {
    return this.collected.filter(function (item) { return item._type === 'contact' })
  },

  _add: function (item) {
    if (!item) return
    var ns = item.network_specific || {}
    var key = item._type + ':' + (ns.room_id || ns.room || '') + ':' + (item.id || item.display_name || item.url || '')
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // --------------------------------------------------------------------------
  // Low-level helpers
  // --------------------------------------------------------------------------

  _roomType: function (name, subtitle, panelText, memberCount) {
    var text = [name, subtitle, panelText].join(' ')
    if (/(direct|\bdm\b|mensaje directo)/i.test(text)) return 'direct'
    if (memberCount || /(miembros|members|personas|people|usuarios|users|sala|room)/i.test(text)) return 'room'
    return 'room'
  },

  _bestHeaderTitle: function (header) {
    if (!header) return ''
    var lines = this._visibleText(header).split('\n').map(this._clean.bind(this)).filter(Boolean)
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length < 140 && !/(members|miembros|people|personas|encrypted|cifrado)/i.test(lines[i])) return lines[i]
    }
    return ''
  },

  _roomIdFromDom: function (root) {
    var attrs = ['data-room-id', 'data-roomid', 'data-room', 'data-id']
    var selector = attrs.map(function (attr) { return '[' + attr + ']' }).join(',')
    var nodes = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll(selector) : [])
    for (var i = 0; i < nodes.length; i++) {
      for (var j = 0; j < attrs.length; j++) {
        var value = this._clean(nodes[i].getAttribute(attrs[j]))
        if (/^![^:\s]+:[^\s]+/.test(value)) return value
      }
    }
    var text = this._visibleText(root)
    var m = /![A-Za-z0-9_-]+:[A-Za-z0-9_.:-]+/.exec(text)
    return m ? m[0] : ''
  },

  _roomIdFromUrl: function () {
    try {
      var decoded = decodeURIComponent(location.href)
      var m = /(?:#\/room\/|matrix\.to\/#\/)(![^/?#\s]+:[^/?#\s]+)/i.exec(decoded)
      return m ? m[1] : ''
    } catch (_) {
      return ''
    }
  },

  _roomAliasFromDom: function (root) {
    if (!root) return ''
    var text = this._visibleText(root)
    var m = /#[A-Za-z0-9_.=-]+:[A-Za-z0-9_.:-]+/.exec(text)
    if (m) return m[0]
    var anchors = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('a[href]') : [])
    for (var i = 0; i < anchors.length; i++) {
      var alias = this._roomAliasFromHref(anchors[i].getAttribute('href') || anchors[i].href)
      if (alias) return alias
    }
    return ''
  },

  _roomAliasFromUrl: function () {
    return this._roomAliasFromHref(location.href)
  },

  _roomAliasFromHref: function (href) {
    try {
      var decoded = decodeURIComponent(String(href || ''))
      var m = /(?:#\/room\/|matrix\.to\/#\/)(#[^/?#\s]+:[^/?#\s]+)/i.exec(decoded)
      if (m) return m[1]
      var any = /#[A-Za-z0-9_.=-]+:[A-Za-z0-9_.:-]+/.exec(decoded)
      return any ? any[0] : ''
    } catch (_) {
      return ''
    }
  },

  _userIdFromNode: function (node) {
    if (!node) return ''
    var attrs = ['data-user-id', 'data-member-id', 'data-sender', 'data-sender-id', 'data-mx-user-id', 'aria-label', 'title']
    for (var i = 0; i < attrs.length; i++) {
      var value = this._clean(node.getAttribute && node.getAttribute(attrs[i]))
      var id = this._matrixUserIdFromText(value)
      if (id) return id
    }
    var hrefNode = node.matches && node.matches('a[href]') ? node : node.querySelector && node.querySelector('a[href*="matrix.to/#/@"]')
    if (hrefNode) {
      var href = this._clean(hrefNode.getAttribute('href') || hrefNode.href)
      var hid = this._matrixUserIdFromText(this._decode(href))
      if (hid) return hid
    }
    return this._matrixUserIdFromText(this._visibleText(node))
  },

  _matrixUserIdFromText: function (text) {
    var m = /@[A-Za-z0-9_.=\/+-]+:[A-Za-z0-9_.:-]+/.exec(String(text || ''))
    return m ? m[0] : ''
  },

  _memberCount: function (text) {
    text = this._clean(text)
    var m = /([\d.,\s]+)\s*(?:miembros|members|personas|people|usuarios|users)/i.exec(text)
    if (!m) return null
    var digits = m[1].replace(/[^\d]/g, '')
    return digits ? Number(digits) : null
  },

  _links: function (root) {
    var out = []
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('a[href]') : []).forEach(function (a) {
      if (a.closest && a.closest('.mx_EventTile_sender, [class*="EventTile_sender"], [class*="SenderProfile"], [class*="sender" i]')) return
      var href = a.href || a.getAttribute('href') || ''
      if (!/^https?:/i.test(href)) {
        try { href = new URL(href, location.origin).href } catch (_) {}
      }
      if (!/^https?:/i.test(href)) return
      if (out.indexOf(href) === -1) out.push(href)
    })
    return out.slice(0, 20)
  },

  _messageStableId: function (room, sender, text, idx) {
    return this._safeName([room && (room.id || room.name), sender, text.slice(0, 32), idx].join('_')).slice(0, 160)
  },

  _looksLikeMessageMeta: function (text) {
    return /^(\d{1,2}:\d{2}|edited|editado|encrypted|cifrado|read|leido)$/i.test(this._clean(text))
  },

  _firstText: function (selectors, root) {
    root = root || document
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector && root.querySelector(selectors[i])
      var text = this._clean(el && (el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label')) || el.innerText || el.textContent))
      if (text) return text.split('\n')[0]
    }
    return ''
  },

  _firstLongText: function (root, exclude) {
    if (!root || !root.querySelectorAll) return ''
    exclude = this._clean(exclude)
    var nodes = Array.prototype.slice.call(root.querySelectorAll('[class*="topic" i], [class*="description" i], [dir="auto"], [dir="ltr"], span, div'))
    for (var i = 0; i < nodes.length; i++) {
      var text = this._clean(nodes[i].innerText || nodes[i].textContent)
      if (!text || text === exclude || text.length < 18 || text.length > 600) continue
      if (/(miembros|members|people|personas|online|encrypted|cifrado)/i.test(text)) continue
      return text
    }
    return ''
  },

  _imageSrc: function (selectors, root) {
    root = root || document
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector && root.querySelector(selectors[i])
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

  _decode: function (value) {
    try { return decodeURIComponent(String(value || '')) } catch (_) { return String(value || '') }
  },

  _merge: function (base, patch) {
    var out = {}
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k] })
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') out[k] = patch[k]
    })
    return out
  },

  _isScrollable: function (node) {
    return !!(node && node.scrollHeight > node.clientHeight + 10)
  },

  _sleep: function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms || 0) })
  },

  _downloadRows: function (prefix, rows) {
    var bytes = NarsilExport.toXLSX(rows)
    if (!bytes) return
    var b64 = NarsilExport.uint8ToBase64(bytes)
    this._sendDownloadBinary(
      prefix + '_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.xlsx',
      b64,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  },

  _sendDownload: function (filename, content, mimeType) {
    var safe = this._safeName(filename || 'matrix_report.txt')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('Matrix: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('Matrix: error de descarga - ' + e.message, 'err')
      })
  },

  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = this._safeName(filename || 'matrix_export.xlsx')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('Matrix: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('Matrix: error de descarga - ' + e.message, 'err')
      })
  },

  _safeName: function (value) {
    return String(value || 'matrix_export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
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
