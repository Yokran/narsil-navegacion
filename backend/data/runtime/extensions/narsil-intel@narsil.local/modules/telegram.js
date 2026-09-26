// NARSIL Intel Collector - modules/telegram.js
// Conservative Telegram Web collector. Active actions read only the visible DOM
// loaded by the operator; no cookies, storage, tokens or MTProto credentials.
'use strict'

NarsilModules.telegram = {
  network: 'telegram',
  collected: [],
  _seen: {},
  _contactsByKey: {},
  _messagesByKey: {},
  _groupsByKey: {},

  getPageType: function () {
    if (this._isLoginView(document)) return 'login'
    if (this._hasMemberPanel(document)) return 'group_info'
    if (this._hasChat(document)) return 'chat'
    return 'unknown'
  },

  getActions: function () {
    var type = this.getPageType()
    if (type === 'login') return [{ id: 'blocked', label: 'Sesion no iniciada' }]
    var actions = []
    if (type === 'chat' || type === 'group_info') {
      actions.push({ id: 'chat_report', label: 'Reporte del chat/canal (TXT)' })
      if (type === 'group_info') actions.push({ id: 'visible_members', label: 'Miembros visibles -> XLSX' })
      actions.push({ id: 'visible_messages', label: 'Mensajes visibles -> XLSX' })
    }
    if (Object.keys(this._contactsByKey).length || this._contactItems().length) {
      actions.push({ id: 'captured_contacts', label: 'Contactos capturados -> XLSX' })
    }
    return actions
  },

  runAction: function (id) {
    switch (id) {
      case 'chat_report':       this._actionChatReport(); break
      case 'visible_members':   this._actionVisibleMembers(); break
      case 'visible_messages':  this._actionVisibleMessages(); break
      case 'captured_contacts': this._actionCapturedContacts(); break
      case 'blocked':
        NarsilPanel && NarsilPanel.log('Telegram: inicia sesion manualmente antes de extraer datos.', 'err')
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
    this._contactsByKey = {}
    this._messagesByKey = {}
    this._groupsByKey = {}
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  onPageData: function () {},

  onNetworkRequest: function () {},

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  _actionChatReport: function () {
    try {
      var chat = this._extractChat(document)
      if (!chat.title && !chat.username && !chat.id) {
        NarsilPanel && NarsilPanel.log('Telegram: no se pudo identificar el chat visible.', 'err')
        return
      }
      var members = this._extractMembers(document, chat)
      var messages = this._extractMessages(document, chat)
      this._rememberChat(chat, members)
      this._sendDownload(
        'telegram_chat_' + this._safeName(chat.username || chat.title || chat.id || 'visible') + '.txt',
        this._chatToText(chat, members, messages),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('Telegram: reporte del chat/canal descargado.', 'ok')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('Telegram: error preparando reporte - ' + e.message, 'err')
    }
  },

  _actionVisibleMembers: function () {
    var self = this
    var chat = this._extractChat(document)
    var panel = this._findMemberPanel(document)
    if (!panel) {
      NarsilPanel && NarsilPanel.log('Telegram: abre manualmente la informacion del grupo/canal y su lista de miembros.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('Telegram: recorriendo lista lateral de miembros...')
    this._scanMembers(panel, chat).then(function (scan) {
      var rows = self._memberRows(chat.title)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Telegram: no hay miembros visibles capturados. Asegurate de tener abierta la lista de miembros.', 'err')
        return
      }
      self._downloadRows('telegram_miembros_' + self._safeName(chat.username || chat.title || 'chat'), rows)
      var detail = scan && scan.steps ? ' en ' + scan.steps + ' pasos' : ''
      NarsilPanel && NarsilPanel.log('Telegram: ' + rows.length + ' miembros exportados' + detail + '.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('Telegram: error extrayendo miembros - ' + e.message, 'err')
    })
  },

  _actionVisibleMessages: function () {
    try {
      var chat = this._extractChat(document)
      var messages = this._extractMessages(document, chat)
      var rows = this._messageRows(messages, chat)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Telegram: no hay mensajes visibles para exportar.', 'err')
        return
      }
      this._downloadRows('telegram_mensajes_' + this._safeName(chat.username || chat.title || 'chat'), rows)
      NarsilPanel && NarsilPanel.log('Telegram: ' + rows.length + ' mensajes visibles exportados.', 'ok')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('Telegram: error extrayendo mensajes - ' + e.message, 'err')
    }
  },

  _actionCapturedContacts: function () {
    var rows = this._memberRows()
    if (!rows.length) rows = this._contactItems().map(this._contactItemToRow.bind(this))
    if (!rows.length) {
      NarsilPanel && NarsilPanel.log('Telegram: no hay contactos capturados todavia.', 'err')
      return
    }
    this._downloadRows('telegram_contactos_capturados', rows)
    NarsilPanel && NarsilPanel.log('Telegram: ' + rows.length + ' contactos capturados exportados.', 'ok')
  },

  // --------------------------------------------------------------------------
  // DOM extraction
  // --------------------------------------------------------------------------

  _extractChat: function (doc) {
    var panel = this._findMemberPanel(doc)
    var header = this._chatHeader(doc)
    var title = this._firstText([
      '.chat-info .peer-title',
      '.ChatInfo .peer-title',
      '.chat-title .peer-title',
      '.topbar .peer-title',
      '[class*="chat-info" i] [class*="title" i]',
      '[class*="ChatInfo" i] [class*="title" i]',
      'header [class*="title" i]',
      'header [dir="auto"]',
    ], doc)
    if (!title && header) title = this._bestHeaderTitle(header)

    var subtitle = this._firstText([
      '.chat-info .status',
      '.ChatInfo .status',
      '.chat-title .status',
      '.topbar .status',
      '[class*="chat-info" i] [class*="status" i]',
      '[class*="ChatInfo" i] [class*="status" i]',
      'header [class*="status" i]',
    ], doc)
    var panelText = this._visibleText(panel)
    var description = panel ? this._firstLongText(panel, title) : ''
    var username = panel ? this._usernameFromDom(panel) : ''
    if (!username) username = this._usernameFromUrl()
    var id = this._chatIdFromDom(doc) || username || title
    var memberCount = this._memberCount(subtitle || panelText)
    var avatar = this._imageSrc([
      '.chat-info img',
      '.ChatInfo img',
      '[class*="chat-info" i] img',
      '[class*="ChatInfo" i] img',
      'header img',
      '.right-column img',
      '[class*="right-column" i] img',
    ], doc)
    var type = this._chatType(title, subtitle, panelText, panel, memberCount)
    return {
      id: this._clean(id),
      title: this._clean(title),
      username: this._clean(username).replace(/^@/, ''),
      type: type,
      subtitle: this._clean(subtitle),
      description: this._clean(description),
      member_count: memberCount,
      avatar_url: avatar,
      url: username ? 'https://t.me/' + username.replace(/^@/, '') : location.href,
      captured_at: new Date().toISOString(),
    }
  },

  _extractMembers: function (doc, chat) {
    chat = chat || this._extractChat(doc)
    var panel = this._findMemberPanel(doc)
    if (!panel) return []
    var out = []
    var seen = {}
    var self = this
    this._memberNodes(panel).forEach(function (node) {
      var member = self._memberFromNode(node, chat)
      if (!member) return
      var key = self._memberKey(member)
      if (seen[key]) return
      seen[key] = true
      self._rememberMember(member)
      out.push(member)
    })
    return out
  },

  _extractMessages: function (doc, chat) {
    chat = chat || this._extractChat(doc)
    var out = []
    var seen = {}
    var self = this
    this._messageNodes(doc).forEach(function (node, idx) {
      var msg = self._messageFromNode(node, chat, idx)
      if (!msg) return
      var key = msg.id || [chat.title, msg.direction, msg.sender_name, msg.time, msg.text].join('|')
      if (seen[key]) return
      seen[key] = true
      self._rememberMessage(msg)
      self._add(NarsilSchema.post('telegram', {
        id: msg.id,
        author_id: msg.sender_id,
        author_username: msg.sender_username || msg.sender_name,
        content: msg.text,
        media_urls: msg.media_urls,
        published_at: msg.date || msg.time || null,
        url: location.href,
        network_specific: {
          chat: chat.title,
          direction: msg.direction,
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
    return !!doc.querySelector('input[name="phone_number"], input[type="tel"], .qr-container, [class*="qr" i]')
  },

  _hasChat: function (doc) {
    return !!(this._chatHeader(doc) || this._messageNodes(doc).length || /#(?:@|\/im\?p=)/.test(location.hash || ''))
  },

  _hasMemberPanel: function (doc) {
    var panel = this._findMemberPanel(doc)
    return !!(panel && (this._memberNodes(panel).length || /(miembros|members|suscriptores|subscribers|participantes|participants)/i.test(this._visibleText(panel))))
  },

  _chatHeader: function (doc) {
    return doc.querySelector('.chat-info, .ChatInfo, .topbar, header, [class*="chat-info" i], [class*="ChatInfo" i]')
  },

  _findMemberPanel: function (doc) {
    var selectors = [
      '.right-column',
      '.RightColumn',
      '[class*="right-column" i]',
      '[class*="RightColumn" i]',
      '.Profile',
      '[class*="profile" i]',
      '[class*="sidebar" i]',
      '[role="dialog"]',
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
      node.getAttribute && node.getAttribute('data-testid'),
    ].filter(Boolean).join(' ')
    var hasMemberText = /(miembros|members|suscriptores|subscribers|participantes|participants|administradores|admins)/i.test(text)
    var hasInfoAttr = /(right-column|profile|sidebar|dialog|info)/i.test(attr)
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
      if (r.width >= 220 && r.width <= 560) score += 4
      if (r.left > window.innerWidth * 0.35) score += 8
      if (r.height > 280) score += 2
    } catch (_) {}
    return score
  },

  _memberNodes: function (root) {
    if (!root || !root.querySelectorAll) return []
    var selectors = [
      '.ListItem',
      '.list-item',
      '.user-item',
      '.member-item',
      '[role="listitem"]',
      '[class*="member" i]',
      '[class*="participant" i]',
      '[data-peer-id]',
      '[data-user-id]',
      'a[href*="t.me/"]',
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
    if (node.matches && node.matches('.ListItem, .list-item, .user-item, .member-item, [role="listitem"], [data-peer-id], [data-user-id]')) return node
    var closest = node.closest && node.closest('.ListItem, .list-item, .user-item, .member-item, [role="listitem"], [data-peer-id], [data-user-id]')
    if (closest) return closest
    var cls = String(node.className || '')
    if (/(^|\s)(member|member-item|participant|participant-item|user|user-item)(\s|$)/i.test(cls)) return node
    return null
  },

  _looksLikeMemberNode: function (node) {
    var text = this._clean(node && node.textContent)
    if (!text || text.length > 420) return false
    if (node.closest && node.closest('.chat-list, [class*="chat-list" i], [class*="messages" i], [class*="MessageList" i]')) return false
    if (/(miembros|members|suscriptores|subscribers|participantes|participants)$/i.test(text)) return false
    if (node.querySelector && node.querySelector('[class*="title" i], .peer-title, img, a[href*="t.me/"], [data-peer-id], [data-user-id]')) return true
    return /@[A-Za-z0-9_]{3,}|online|en linea|last seen|visto|admin|bot/i.test(text)
  },

  _memberFromNode: function (node, chat) {
    var name = this._memberName(node)
    var username = this._usernameFromNode(node)
    var id = this._idFromNode(node) || username
    var status = this._memberStatus(node, name)
    var role = this._memberRole(node.textContent || '')
    var avatar = this._imageSrc(['img'], node)
    if (!name && !username && !id) return null
    return {
      id: this._clean(id),
      name: name || username || id,
      username: username,
      status: status,
      role: role,
      chat: chat && chat.title || '',
      avatar_url: avatar,
      source: 'dom_visible_member',
    }
  },

  _memberName: function (node) {
    var selectors = [
      '.peer-title',
      '[class*="peer-title" i]',
      '[class*="title" i] [dir="auto"]',
      '[class*="title" i]',
      '[dir="auto"]',
    ]
    for (var i = 0; i < selectors.length; i++) {
      var el = node.querySelector && node.querySelector(selectors[i])
      var text = this._clean(el && (el.getAttribute && el.getAttribute('title') || el.innerText || el.textContent))
      if (text && text.length < 120 && !/(miembros|members|suscriptores|subscribers|participantes|participants)/i.test(text)) return text
    }
    var first = this._clean((node.innerText || node.textContent || '').split('\n')[0])
    return first && first.length < 120 ? first : ''
  },

  _memberStatus: function (node, name) {
    var selectors = ['.status', '.subtitle', '[class*="status" i]', '[class*="subtitle" i]']
    for (var i = 0; i < selectors.length; i++) {
      var el = node.querySelector && node.querySelector(selectors[i])
      var text = this._clean(el && (el.innerText || el.textContent))
      if (text && text !== name && text.length < 180) return text
    }
    var lines = this._visibleText(node).split('\n').map(this._clean.bind(this)).filter(Boolean)
    for (var j = 0; j < lines.length; j++) {
      if (lines[j] !== name && lines[j].length < 180) return lines[j]
    }
    return ''
  },

  _memberRole: function (text) {
    if (/(creador|owner|creator)/i.test(text)) return 'owner'
    if (/(admin|administrador)/i.test(text)) return 'admin'
    if (/\bbot\b/i.test(text)) return 'bot'
    return 'member'
  },

  _messageNodes: function (doc) {
    var nodes = []
    function add(node) {
      if (node && nodes.indexOf(node) === -1) nodes.push(node)
    }
    Array.prototype.slice.call(doc.querySelectorAll(
      '[data-message-id], [data-mid], .message, .Message, [class*="message-list-item" i], [class*="bubble" i]'
    )).forEach(add)
    return nodes.filter(function (node) {
      if (node.closest && node.closest('.right-column, .RightColumn, [class*="right-column" i], [class*="profile" i], [class*="sidebar" i], aside')) return false
      var text = (node.innerText || node.textContent || '').trim()
      return text || (node.querySelector && node.querySelector('img, video, audio, a[href]'))
    })
  },

  _messageFromNode: function (node, chat, idx) {
    var text = this._messageText(node)
    var media = this._messageMedia(node)
    var links = this._links(node)
    if (!text && !media.types.length && !links.length) return null
    var sender = this._messageSender(node)
    var username = this._usernameFromNode(node)
    var id = this._clean(node.getAttribute && (
      node.getAttribute('data-message-id') ||
      node.getAttribute('data-mid') ||
      node.getAttribute('data-id') ||
      node.getAttribute('id')
    ))
    if (!id) id = this._messageStableId(chat, sender, text, idx)
    return {
      id: id,
      direction: this._messageDirection(node),
      sender_id: this._idFromNode(node),
      sender_name: sender,
      sender_username: username,
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
      '.text-content',
      '[class*="text-content" i]',
      '[class*="message-text" i]',
      '[class*="MessageText" i]',
      '[class*="TranslatableMessage" i]',
      '.message-content [dir]',
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

  _messageSender: function (node) {
    return this._firstText([
      '.sender-title',
      '[class*="sender-title" i]',
      '[class*="sender" i] [dir]',
      '[class*="message-title" i]',
      '.peer-title',
    ], node)
  },

  _messageDirection: function (node) {
    var classes = String(node.className || '')
    if (/(own|outgoing|is-out|message-out)/i.test(classes)) return 'saliente'
    if (/(incoming|message-in|is-in)/i.test(classes)) return 'entrante'
    return ''
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
    var text = this._firstText(['.time', '.message-time', '[class*="time" i]'], node) || this._clean(node.textContent)
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
    if (/document|archivo|file/i.test(html)) add('documento')
    if (/voice|audio|round-video/i.test(html)) add('audio')
    if (/sticker|gif/i.test(html)) add('sticker')
    return { types: Object.keys(types), urls: urls.slice(0, 10) }
  },

  // --------------------------------------------------------------------------
  // Scroll and row builders
  // --------------------------------------------------------------------------

  _scanMembers: async function (panel, chat) {
    chat = chat || this._extractChat(document)
    var container = this._memberScrollContainer(panel) || panel
    var steps = 0
    var idle = 0
    var prev = -1
    var maxSteps = 80
    var step = Math.max(260, Math.floor((container.clientHeight || 620) * 0.85))

    try { container.scrollTop = 0 } catch (_) {}
    this._extractMembers(document, chat)
    await this._sleep(220)

    while (steps < maxSteps && idle < 12) {
      this._extractMembers(document, chat)
      var count = this._memberRows(chat.title).length
      if (count > prev) {
        prev = count
        idle = 0
      } else {
        idle++
      }
      if (steps === 0 || steps % 10 === 0) {
        NarsilPanel && NarsilPanel.log('Telegram: miembros detectados hasta ahora: ' + count)
      }
      var movement = this._driveScroll(container, step)
      steps++
      await this._sleep(180)
      if (!movement.moved && movement.atEnd && idle >= 3) break
    }
    this._extractMembers(document, chat)
    return { steps: steps }
  },

  _memberScrollContainer: function (panel) {
    if (!panel) return null
    var candidates = [panel]
    Array.prototype.slice.call(panel.querySelectorAll ? panel.querySelectorAll('[role="list"], .scrollable, [class*="scroll" i], [class*="List" i], div') : []).forEach(function (node) {
      candidates.push(node)
    })
    var self = this
    var scored = candidates.map(function (node) {
      var score = 0
      if (self._isScrollable(node)) score += 12
      score += Math.min(self._memberNodes(node).length * 3, 24)
      var text = self._visibleText(node).slice(0, 500)
      if (/(miembros|members|suscriptores|subscribers|participantes|participants)/i.test(text)) score += 6
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

  _memberRows: function (chatTitle) {
    var self = this
    return Object.keys(this._contactsByKey).sort(function (a, b) {
      var ma = self._contactsByKey[a]
      var mb = self._contactsByKey[b]
      return String(ma.name || '').localeCompare(String(mb.name || ''))
    }).map(function (key) {
      return self._contactsByKey[key]
    }).filter(function (m) {
      return !chatTitle || !m.chat || m.chat === chatTitle
    }).map(function (m) {
      return {
        'ID': m.id || NarsilExport.missing('id no visible'),
        'Nombre': m.name || NarsilExport.missing('nombre no visible'),
        'Username': m.username || NarsilExport.missing('username no visible'),
        'Estado': m.status || NarsilExport.missing('estado no visible'),
        'Rol': m.role || NarsilExport.missing(),
        'Chat': m.chat || NarsilExport.missing('chat no capturado'),
        'Avatar': m.avatar_url || NarsilExport.missing(),
      }
    })
  },

  _messageRows: function (messages, chat) {
    chat = chat || {}
    return (messages || []).map(function (m) {
      return {
        'Chat': chat.title || NarsilExport.missing('chat no capturado'),
        'Direccion': m.direction || NarsilExport.missing(),
        'Remitente': m.sender_name || NarsilExport.missing('remitente no visible'),
        'Username remitente': m.sender_username || NarsilExport.missing('username no visible'),
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
      'Username': item.username || NarsilExport.missing('username no visible'),
      'Estado': ns.status || NarsilExport.missing('estado no visible'),
      'Rol': item.role || NarsilExport.missing(),
      'Chat': ns.chat || NarsilExport.missing('chat no capturado'),
      'Avatar': item.avatar_url || NarsilExport.missing(),
    }
  },

  _chatToText: function (chat, members, messages) {
    var lines = ['Telegram chat/channel report', 'Captured: ' + chat.captured_at, 'URL: ' + (chat.url || location.href), '']
    this._addLine(lines, 'Type', chat.type)
    this._addLine(lines, 'ID', chat.id)
    this._addLine(lines, 'Title', chat.title)
    this._addLine(lines, 'Username', chat.username && '@' + chat.username)
    this._addLine(lines, 'Subtitle', chat.subtitle)
    this._addLine(lines, 'Member count text/parsed', chat.member_count)
    this._addLine(lines, 'Avatar URL', chat.avatar_url)
    this._addBlock(lines, 'Description', chat.description)
    this._addLine(lines, 'Visible members extracted', members.length)
    this._addLine(lines, 'Visible messages extracted', messages.length)
    return lines.join('\n')
  },

  // --------------------------------------------------------------------------
  // Cache and schema helpers
  // --------------------------------------------------------------------------

  _rememberChat: function (chat, members) {
    if (!chat) return null
    var key = chat.id || chat.username || chat.title
    if (!key) return null
    this._groupsByKey[key] = this._merge(this._groupsByKey[key] || {}, chat)
    if (chat.type === 'direct') {
      this._add(NarsilSchema.contact('telegram', {
        id: chat.id || chat.username || chat.title,
        username: chat.username,
        display_name: chat.title,
        avatar_url: chat.avatar_url,
        role: 'chat',
        network_specific: {
          source: 'dom_visible_chat',
          subtitle: chat.subtitle,
        },
      }))
    } else {
      this._add(NarsilSchema.group('telegram', {
        id: chat.id || chat.username || chat.title,
        name: chat.title,
        description: chat.description,
        member_count: chat.member_count || (members && members.length) || null,
        url: chat.url,
        members: (members || []).map(function (m) { return m.id || m.username || m.name }).filter(Boolean),
        network_specific: {
          username: chat.username,
          subtitle: chat.subtitle,
          avatar_url: chat.avatar_url,
          source: 'dom_visible_chat',
        },
      }))
    }
    return this._groupsByKey[key]
  },

  _rememberMember: function (member) {
    if (!member) return null
    var key = this._memberKey(member)
    var merged = this._merge(this._contactsByKey[key] || {}, member)
    this._contactsByKey[key] = merged
    this._add(NarsilSchema.contact('telegram', {
      id: merged.id || merged.username || merged.name,
      username: merged.username,
      display_name: merged.name,
      role: merged.role,
      avatar_url: merged.avatar_url,
      network_specific: {
        status: merged.status,
        chat: merged.chat,
        source: merged.source,
      },
    }))
    return merged
  },

  _rememberMessage: function (msg) {
    if (!msg) return null
    var key = msg.id || [msg.sender_name, msg.time, msg.text].join('|')
    this._messagesByKey[key] = this._merge(this._messagesByKey[key] || {}, msg)
    return this._messagesByKey[key]
  },

  _memberKey: function (member) {
    return [member.chat || '', member.id || '', member.username || '', this._fold(member.name || '')].join(':')
  },

  _contactItems: function () {
    return this.collected.filter(function (item) { return item._type === 'contact' })
  },

  _add: function (item) {
    if (!item) return
    var ns = item.network_specific || {}
    var key = item._type + ':' + (ns.chat ? ns.chat + ':' : '') + (item.id || item.username || item.display_name || item.url || '')
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // --------------------------------------------------------------------------
  // Low-level helpers
  // --------------------------------------------------------------------------

  _chatType: function (title, subtitle, panelText, panel, memberCount) {
    var text = [title, subtitle, panelText].join(' ')
    if (/(canal|channel|suscriptores|subscribers)/i.test(text)) return 'channel'
    if (panel || memberCount || /(grupo|group|miembros|members|participantes|participants)/i.test(text)) return 'group'
    return 'direct'
  },

  _bestHeaderTitle: function (header) {
    if (!header) return ''
    var lines = this._visibleText(header).split('\n').map(this._clean.bind(this)).filter(Boolean)
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length < 140 && !/(online|en linea|visto|last seen|members|miembros|subscribers|suscriptores)/i.test(lines[i])) return lines[i]
    }
    return ''
  },

  _usernameFromDom: function (root) {
    var anchors = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('a[href]') : [])
    for (var i = 0; i < anchors.length; i++) {
      var username = this._usernameFromHref(anchors[i].getAttribute('href') || anchors[i].href)
      if (username) return username
    }
    var text = this._visibleText(root)
    var m = /(?:^|\s)@([A-Za-z0-9_]{3,32})\b/.exec(text)
    return m ? m[1] : ''
  },

  _usernameFromNode: function (node) {
    if (!node) return ''
    var anchors = Array.prototype.slice.call(node.querySelectorAll ? node.querySelectorAll('a[href]') : [])
    for (var i = 0; i < anchors.length; i++) {
      var username = this._usernameFromHref(anchors[i].getAttribute('href') || anchors[i].href)
      if (username) return username
    }
    var text = this._visibleText(node)
    var m = /(?:^|\s)@([A-Za-z0-9_]{3,32})\b/.exec(text)
    return m ? m[1] : ''
  },

  _usernameFromHref: function (href) {
    href = String(href || '')
    var direct = /(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,32})(?:[/?#]|$)/i.exec(href)
    if (direct) return direct[1]
    var hash = /#@([A-Za-z0-9_]{3,32})\b/i.exec(href)
    return hash ? hash[1] : ''
  },

  _usernameFromUrl: function () {
    return this._usernameFromHref(location.href) || this._usernameFromHref(location.hash || '')
  },

  _chatIdFromDom: function (root) {
    var attrs = ['data-peer-id', 'data-chat-id', 'data-channel-id', 'data-id']
    var nodes = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll(attrs.map(function (a) { return '[' + a + ']' }).join(',')) : [])
    for (var i = 0; i < nodes.length; i++) {
      var id = this._idFromNode(nodes[i])
      if (id) return id
    }
    var h = String(location.hash || '')
    var m = /(?:p=|#)(?:c|g|u)?(-?\d{5,})/.exec(h)
    return m ? m[1] : ''
  },

  _idFromNode: function (node) {
    if (!node || !node.getAttribute) return ''
    var attrs = ['data-peer-id', 'data-user-id', 'data-chat-id', 'data-channel-id', 'data-id', 'data-peer']
    for (var i = 0; i < attrs.length; i++) {
      var value = this._clean(node.getAttribute(attrs[i]))
      var m = /-?\d{5,}/.exec(value)
      if (m) return m[0]
    }
    var hrefNode = node.matches && node.matches('a[href]') ? node : node.querySelector && node.querySelector('a[href]')
    var href = hrefNode && (hrefNode.getAttribute('href') || hrefNode.href) || ''
    var hm = /(?:p=|#)(?:c|g|u)?(-?\d{5,})/.exec(href)
    return hm ? hm[1] : ''
  },

  _memberCount: function (text) {
    text = this._clean(text)
    var m = /([\d.,\s]+)\s*(?:miembros|members|suscriptores|subscribers|participantes|participants)/i.exec(text)
    if (!m) return null
    var digits = m[1].replace(/[^\d]/g, '')
    return digits ? Number(digits) : null
  },

  _links: function (root) {
    var out = []
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('a[href]') : []).forEach(function (a) {
      if (a.closest && a.closest('.sender-title, [class*="sender-title" i], [class*="sender" i], [class*="message-title" i]')) return
      var href = a.href || a.getAttribute('href') || ''
      if (!/^https?:/i.test(href)) {
        try { href = new URL(href, location.origin).href } catch (_) {}
      }
      if (!/^https?:/i.test(href)) return
      if (out.indexOf(href) === -1) out.push(href)
    })
    return out.slice(0, 20)
  },

  _messageStableId: function (chat, sender, text, idx) {
    return this._safeName([chat && chat.title, sender, text.slice(0, 32), idx].join('_')).slice(0, 160)
  },

  _looksLikeMessageMeta: function (text) {
    return /^(\d{1,2}:\d{2}|edited|editado|views?|vistas?|reenviado|forwarded)$/i.test(this._clean(text))
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
    var nodes = Array.prototype.slice.call(root.querySelectorAll('[class*="about" i], [class*="description" i], [dir="auto"], [dir="ltr"], span, div'))
    for (var i = 0; i < nodes.length; i++) {
      var text = this._clean(nodes[i].innerText || nodes[i].textContent)
      if (!text || text === exclude || text.length < 18 || text.length > 500) continue
      if (/(miembros|members|suscriptores|subscribers|participantes|participants|online|en linea)/i.test(text)) continue
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
    var safe = this._safeName(filename || 'telegram_report.txt')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('Telegram: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('Telegram: error de descarga - ' + e.message, 'err')
      })
  },

  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = this._safeName(filename || 'telegram_export.xlsx')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('Telegram: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('Telegram: error de descarga - ' + e.message, 'err')
      })
  },

  _safeName: function (value) {
    return String(value || 'telegram_export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
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
