// NARSIL Intel Collector - modules/whatsapp.js
// Conservative WhatsApp Web collector. It only reads the visible DOM loaded by
// the operator. It does not read cookies, storage, tokens or private requests.
'use strict'

NarsilModules.whatsapp = {
  network: 'whatsapp',
  collected: [],
  _seen: {},
  _contactsByKey: {},
  _messagesByKey: {},

  _COUNTRY_CODES: {
    '1': 'US/CA', '7': 'RU/KZ', '20': 'EG', '27': 'ZA', '30': 'GR', '31': 'NL',
    '32': 'BE', '33': 'FR', '34': 'ES', '36': 'HU', '39': 'IT', '40': 'RO',
    '41': 'CH', '43': 'AT', '44': 'GB', '45': 'DK', '46': 'SE', '47': 'NO',
    '48': 'PL', '49': 'DE', '51': 'PE', '52': 'MX', '53': 'CU', '54': 'AR',
    '55': 'BR', '56': 'CL', '57': 'CO', '58': 'VE', '60': 'MY', '61': 'AU',
    '62': 'ID', '63': 'PH', '64': 'NZ', '65': 'SG', '66': 'TH', '81': 'JP',
    '82': 'KR', '84': 'VN', '86': 'CN', '90': 'TR', '91': 'IN', '92': 'PK',
    '93': 'AF', '94': 'LK', '95': 'MM', '98': 'IR', '212': 'MA', '213': 'DZ',
    '216': 'TN', '218': 'LY', '220': 'GM', '221': 'SN', '233': 'GH',
    '234': 'NG', '254': 'KE', '255': 'TZ', '256': 'UG', '260': 'ZM',
    '263': 'ZW', '351': 'PT', '352': 'LU', '353': 'IE', '358': 'FI',
    '380': 'UA', '385': 'HR', '386': 'SI', '420': 'CZ', '421': 'SK',
  },

  getPageType: function () {
    if (document.querySelector('[data-testid="qrcode"], canvas[aria-label*="Scan" i], canvas[aria-label*="escan" i]')) return 'login'
    if (this._hasParticipantPanel(document)) return 'group_info'
    if (this._hasChat(document)) return 'chat'
    return 'unknown'
  },

  getActions: function () {
    var type = this.getPageType()
    if (type === 'login') return [{ id: 'blocked', label: 'Sesion no iniciada' }]
    var actions = []
    if (type === 'chat' || type === 'group_info') {
      actions.push({ id: 'chat_report', label: 'Reporte del chat (TXT)' })
      if (type === 'group_info') actions.push({ id: 'group_members', label: 'Miembros visibles -> XLSX' })
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
      case 'group_members':     this._actionGroupMembers(); break
      case 'visible_messages':  this._actionVisibleMessages(); break
      case 'captured_contacts': this._actionCapturedContacts(); break
      case 'blocked':
        NarsilPanel && NarsilPanel.log('WhatsApp: inicia sesion manualmente antes de extraer datos.', 'err')
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
      if (!chat.title && !chat.phone) {
        NarsilPanel && NarsilPanel.log('WhatsApp: no se pudo identificar el chat visible.', 'err')
        return
      }
      var participants = this._extractParticipants(document, chat)
      var messages = this._extractMessages(document, chat)
      if (chat.type === 'group') {
        this._add(NarsilSchema.group('whatsapp', {
          id: chat.id || chat.title,
          name: chat.title,
          description: chat.description,
          member_count: chat.member_count || participants.length || null,
          url: location.href,
          members: participants.map(function (p) { return p.phone || p.name }).filter(Boolean),
          network_specific: {
            subtitle: chat.subtitle,
            avatar_url: chat.avatar_url,
            source: 'dom_visible_chat',
          },
        }))
      } else {
        this._add(NarsilSchema.contact('whatsapp', {
          id: chat.phone || chat.title,
          display_name: chat.title,
          phone: chat.phone,
          avatar_url: chat.avatar_url,
          role: 'chat',
          network_specific: {
            country: chat.phone ? this._resolveCountry(chat.phone) : null,
            source: 'dom_visible_chat',
          },
        }))
      }
      this._sendDownload(
        'whatsapp_chat_' + this._safeName(chat.title || chat.phone || 'visible') + '.txt',
        this._chatToText(chat, participants, messages),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('WhatsApp: reporte del chat descargado.', 'ok')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('WhatsApp: error preparando reporte - ' + e.message, 'err')
    }
  },

  _actionGroupMembers: function () {
    var self = this
    var chat = this._extractChat(document)
    var root = this._findParticipantPanel(document)
    if (!root) {
      NarsilPanel && NarsilPanel.log('WhatsApp: abre manualmente la informacion del grupo y la lista de participantes.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('WhatsApp: recorriendo lista lateral de miembros...')
    this._scanParticipants(root, chat).then(function (scan) {
      var rows = self._participantRows(chat.title)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('WhatsApp: no hay miembros visibles capturados. Asegurate de tener abierta la lista de participantes.', 'err')
        return
      }
      self._downloadRows('whatsapp_miembros_' + self._safeName(chat.title || 'grupo'), rows)
      var detail = scan && scan.steps ? ' en ' + scan.steps + ' pasos' : ''
      NarsilPanel && NarsilPanel.log('WhatsApp: ' + rows.length + ' miembros exportados' + detail + '.', 'ok')
    }).catch(function (e) {
      NarsilPanel && NarsilPanel.log('WhatsApp: error extrayendo miembros - ' + e.message, 'err')
    })
  },

  _actionVisibleMessages: function () {
    try {
      var chat = this._extractChat(document)
      var messages = this._extractMessages(document, chat)
      var rows = this._messageRows(messages, chat)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('WhatsApp: no hay mensajes visibles para exportar.', 'err')
        return
      }
      this._downloadRows('whatsapp_mensajes_' + this._safeName(chat.title || 'chat'), rows)
      NarsilPanel && NarsilPanel.log('WhatsApp: ' + rows.length + ' mensajes visibles exportados.', 'ok')
    } catch (e) {
      NarsilPanel && NarsilPanel.log('WhatsApp: error extrayendo mensajes - ' + e.message, 'err')
    }
  },

  _actionCapturedContacts: function () {
    var rows = this._participantRows()
    if (!rows.length) rows = this._contactItems().map(this._contactItemToRow.bind(this))
    if (!rows.length) {
      NarsilPanel && NarsilPanel.log('WhatsApp: no hay contactos capturados todavia.', 'err')
      return
    }
    this._downloadRows('whatsapp_contactos_capturados', rows)
    NarsilPanel && NarsilPanel.log('WhatsApp: ' + rows.length + ' contactos capturados exportados.', 'ok')
  },

  // --------------------------------------------------------------------------
  // DOM extraction
  // --------------------------------------------------------------------------

  _extractChat: function (doc) {
    var panel = this._findParticipantPanel(doc)
    var header = doc.querySelector('header') || doc
    var title = this._firstText([
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="chat-info-drawer"] span[title]',
      '[data-testid="drawer-right"] span[title]',
      'header [data-testid="conversation-info-header-chat-title"]',
      'header span[title]',
      'header h1',
    ], doc)
    var subtitle = this._firstText([
      '[data-testid="conversation-info-header-subtitle"]',
      '[data-testid="chat-subtitle"]',
      'header [title*="participante" i]',
      'header [title*="participant" i]',
      'header [aria-label*="participante" i]',
      'header [aria-label*="participant" i]',
    ], doc)
    if (!subtitle) subtitle = this._firstMatchingText(header, /(participantes|participants|miembros|members|en linea|online|ult\.|last seen)/i)
    var panelText = this._visibleText(panel)
    var description = panel ? this._firstLongText(panel, title) : ''
    var phone = this._phoneFromText(title) || this._phoneFromText(subtitle)
    var memberCount = this._memberCount(subtitle || panelText)
    var type = panel || memberCount || /(grupo|group|participantes|participants|miembros|members)/i.test(subtitle + ' ' + panelText)
      ? 'group'
      : 'direct'
    var avatar = this._imageSrc([
      '[data-testid="chat-info-drawer"] img',
      '[data-testid="drawer-right"] img',
      'header img',
    ], doc)

    return {
      id: phone || title,
      title: this._clean(title),
      type: type,
      subtitle: this._clean(subtitle),
      description: this._clean(description),
      phone: phone,
      member_count: memberCount,
      avatar_url: avatar,
      url: location.href,
      captured_at: new Date().toISOString(),
    }
  },

  _extractParticipants: function (doc, chat) {
    chat = chat || this._extractChat(doc)
    var root = this._findParticipantPanel(doc)
    if (!root) return []
    var self = this
    var out = []
    var seen = {}
    this._participantNodes(root).forEach(function (node) {
      var p = self._participantFromNode(node, chat)
      if (!p) return
      var key = self._participantKey(p)
      if (seen[key]) return
      seen[key] = true
      self._rememberParticipant(p)
      out.push(p)
    })
    return out
  },

  _extractMessages: function (doc, chat) {
    chat = chat || this._extractChat(doc)
    var self = this
    var out = []
    var seen = {}
    this._messageNodes(doc).forEach(function (node, idx) {
      var msg = self._messageFromNode(node, chat, idx)
      if (!msg) return
      var key = msg.id || [chat.title, msg.direction, msg.sender_name, msg.time, msg.text].join('|')
      if (seen[key]) return
      seen[key] = true
      self._rememberMessage(msg)
      self._add(NarsilSchema.post('whatsapp', {
        id: msg.id,
        author_username: msg.sender_name,
        content: msg.text,
        media_urls: msg.media_urls,
        published_at: msg.date || msg.time || null,
        url: location.href,
        network_specific: {
          chat: chat.title,
          direction: msg.direction,
          sender_phone: msg.sender_phone,
          media_types: msg.media_types,
          links: msg.links,
          source: 'dom_visible_message',
        },
      }))
      out.push(msg)
    })
    return out
  },

  _hasChat: function (doc) {
    return !!(doc.querySelector('header span[title], [data-testid="conversation-panel-wrapper"], [data-testid="msg-container"], .message-in, .message-out'))
  },

  _hasParticipantPanel: function (doc) {
    var panel = this._findParticipantPanel(doc)
    return !!(panel && (this._participantNodes(panel).length || /(participantes|participants|miembros|members)/i.test(this._visibleText(panel))))
  },

  _findParticipantPanel: function (doc) {
    var self = this
    var selectors = [
      '[data-testid="chat-info-drawer"]',
      '[data-testid="drawer-right"]',
      '[data-testid="conversation-info-panel"]',
      'section[aria-label*="Info" i]',
      'section[aria-label*="grupo" i]',
      'section[aria-label*="group" i]',
      'aside',
    ]
    var candidates = []
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(doc.querySelectorAll(selector)).forEach(function (node) {
        if (candidates.indexOf(node) === -1) candidates.push(node)
      })
    })

    var addButton = doc.querySelector('[data-testid="participant-add-button"], [aria-label*="Anadir participante" i], [aria-label*="Add participant" i]')
    if (addButton) {
      var section = addButton.closest && (addButton.closest('section') || addButton.closest('aside') || addButton.closest('[role="dialog"]'))
      if (section && candidates.indexOf(section) === -1) candidates.push(section)
    }

    var scored = candidates.map(function (node) {
      return { node: node, score: self._scoreParticipantPanel(node) }
    }).filter(function (entry) {
      return entry.score > 0
    }).sort(function (a, b) {
      return b.score - a.score
    })
    return scored.length ? scored[0].node : null
  },

  _scoreParticipantPanel: function (node) {
    if (!node || !node.querySelectorAll) return 0
    var text = this._visibleText(node)
    var attr = [
      node.getAttribute && node.getAttribute('data-testid'),
      node.getAttribute && node.getAttribute('aria-label'),
      typeof node.className === 'string' ? node.className : '',
    ].filter(Boolean).join(' ')
    var hasParticipantText = /(participantes|participants|miembros|members|admin del grupo|group admin)/i.test(text)
    var hasInfoAttr = /drawer|chat-info|conversation-info|group/i.test(attr)
    var isRightPanel = false
    try {
      var probe = node.getBoundingClientRect()
      isRightPanel = probe.left > window.innerWidth * 0.35
    } catch (_) {}
    if (!hasParticipantText && !hasInfoAttr && !isRightPanel) return 0
    var score = 0
    if (hasInfoAttr) score += 12
    if (hasParticipantText) score += 24
    score += Math.min(this._participantNodes(node).length * 5, 35)
    if (this._isScrollable(node)) score += 4
    try {
      var rect = node.getBoundingClientRect()
      if (rect.width >= 220 && rect.width <= 520) score += 4
      if (rect.left > window.innerWidth * 0.35) score += 6
      if (rect.height > 300) score += 2
    } catch (_) {}
    return score
  },

  _participantNodes: function (root) {
    if (!root || !root.querySelectorAll) return []
    var selectors = [
      '[data-testid="participant-container"]',
      '[data-testid="cell-frame-container"]',
      '[role="listitem"]',
      'div[aria-label*="participant" i]',
      'div[aria-label*="participante" i]',
      'div[aria-label*="miembro" i]',
    ]
    var nodes = []
    var self = this
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(root.querySelectorAll(selector)).forEach(function (node) {
        if (nodes.indexOf(node) === -1 && self._looksLikeParticipantNode(node)) nodes.push(node)
      })
    })
    return nodes
  },

  _looksLikeParticipantNode: function (node) {
    var text = this._clean(node && node.textContent)
    if (!text || text.length > 500) return false
    if (node.closest && node.closest('[data-testid="msg-container"], .message-in, .message-out')) return false
    if (this._phoneFromText(text)) return true
    if (/(admin|administrador|creador|owner|participante|participant|miembro|member)/i.test(text)) return true
    if (node.querySelector && node.querySelector('span[title], img, [data-testid*="avatar" i]')) return true
    return false
  },

  _participantFromNode: function (node, chat) {
    var text = this._clean(node.textContent)
    var phone = this._phoneFromText(text)
    var name = this._participantName(node, phone)
    if (!name && !phone) return null
    var role = this._participantRole(text)
    var avatar = this._imageSrc(['img'], node)
    return {
      name: name || phone,
      phone: phone,
      role: role,
      country: phone ? this._resolveCountry(phone) : null,
      group: chat && chat.title || '',
      avatar_url: avatar,
      source: 'dom_visible_participant',
    }
  },

  _participantName: function (node, phone) {
    var self = this
    var values = []
    Array.prototype.slice.call(node.querySelectorAll('span[title], [aria-label], span')).forEach(function (el) {
      var value = self._clean(el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label')) || el.textContent)
      if (!value || values.indexOf(value) !== -1) return
      values.push(value)
    })
    values.push(this._clean(node.getAttribute && node.getAttribute('aria-label')))
    for (var i = 0; i < values.length; i++) {
      var v = values[i]
      if (!v || v.length > 120) continue
      if (phone && this._normalizePhone(v) === phone) continue
      if (this._phoneFromText(v)) continue
      if (/(admin|administrador|creador|owner|participante|participant|miembro|member|mensaje|message)/i.test(v)) continue
      return v
    }
    return ''
  },

  _participantRole: function (text) {
    if (/(creador|owner|creator)/i.test(text)) return 'owner'
    if (/(admin|administrador)/i.test(text)) return 'admin'
    return 'member'
  },

  _messageNodes: function (doc) {
    var nodes = []
    function add(node) {
      if (node && nodes.indexOf(node) === -1) nodes.push(node)
    }
    Array.prototype.slice.call(doc.querySelectorAll('[data-testid="msg-container"], .message-in, .message-out')).forEach(add)
    Array.prototype.slice.call(doc.querySelectorAll('[data-pre-plain-text]')).forEach(function (node) {
      add((node.closest && node.closest('[data-testid="msg-container"], .message-in, .message-out')) || node)
    })
    return nodes.filter(function (node) {
      return !node.closest || !node.closest('[data-testid="chat-info-drawer"], [data-testid="drawer-right"], aside')
    })
  },

  _messageFromNode: function (node, chat, idx) {
    var metaNode = node.querySelector && node.querySelector('[data-pre-plain-text]')
    var meta = metaNode && metaNode.getAttribute('data-pre-plain-text') || ''
    var parsed = this._parseMessageMeta(meta)
    var direction = /\bmessage-out\b/i.test(node.className || '') ? 'saliente' : 'entrante'
    if (/\bmessage-in\b/i.test(node.className || '')) direction = 'entrante'
    var text = this._messageText(node)
    var media = this._messageMedia(node)
    var links = this._links(node)
    if (!text && !media.types.length && !links.length) return null
    var id = this._clean(node.getAttribute && (node.getAttribute('data-id') || node.getAttribute('id'))) || ''
    if (!id) id = this._messageStableId(chat, parsed, text, idx)
    var sender = parsed.sender || (direction === 'saliente' ? 'Yo' : '')
    var senderPhone = this._phoneFromText(sender)
    return {
      id: id,
      direction: direction,
      sender_name: sender,
      sender_phone: senderPhone,
      date: parsed.date,
      time: parsed.time || this._messageTime(node),
      text: text,
      media_types: media.types,
      media_urls: media.urls,
      links: links,
    }
  },

  _parseMessageMeta: function (meta) {
    meta = this._clean(meta)
    var out = { time: '', date: '', sender: '' }
    var m = /^\[([^,\]]+),\s*([^\]]+)\]\s*(.*?):\s*$/.exec(meta)
    if (m) {
      out.time = this._clean(m[1])
      out.date = this._clean(m[2])
      out.sender = this._clean(m[3])
      return out
    }
    var simple = /^\[([^\]]+)\]\s*(.*?):\s*$/.exec(meta)
    if (simple) {
      out.time = this._clean(simple[1])
      out.sender = this._clean(simple[2])
    }
    return out
  },

  _messageText: function (node) {
    var parts = []
    var self = this
    var selectors = [
      '[data-testid="conversation-text"]',
      'span.selectable-text',
      '[data-pre-plain-text] span[dir]',
      'span[dir="ltr"]',
      'span[dir="auto"]',
    ]
    selectors.forEach(function (selector) {
      Array.prototype.slice.call(node.querySelectorAll ? node.querySelectorAll(selector) : []).forEach(function (el) {
        var text = self._clean(el.innerText || el.textContent)
        if (!text || parts.indexOf(text) !== -1) return
        if (/^\d{1,2}:\d{2}$/.test(text)) return
        parts.push(text)
      })
    })
    return parts.join('\n')
  },

  _messageTime: function (node) {
    var text = this._firstText([
      '[data-testid="msg-meta"]',
      '[aria-label*=":"]',
      'span[aria-label*=":"]',
    ], node)
    var m = /\b\d{1,2}:\d{2}\b/.exec(text || this._clean(node.textContent))
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
    var html = [
      node.getAttribute && node.getAttribute('data-testid'),
      node.innerHTML || '',
    ].join(' ')
    if (/document|archivo|file/i.test(html)) add('documento')
    if (/ptt|audio|voice/i.test(html)) add('audio')
    if (/sticker|gif/i.test(html)) add('sticker')
    return { types: Object.keys(types), urls: urls.slice(0, 10) }
  },

  // --------------------------------------------------------------------------
  // Scrolling and row builders
  // --------------------------------------------------------------------------

  _scanParticipants: async function (root, chat) {
    chat = chat || this._extractChat(document)
    var container = this._participantScrollContainer(root) || root
    var steps = 0
    var idle = 0
    var prev = -1
    var maxSteps = 80
    var step = Math.max(260, Math.floor((container.clientHeight || 600) * 0.85))

    try { container.scrollTop = 0 } catch (_) {}
    this._extractParticipants(document, chat)
    await this._sleep(220)

    while (steps < maxSteps && idle < 12) {
      this._extractParticipants(document, chat)
      var count = this._participantRows(chat.title).length
      if (count > prev) {
        prev = count
        idle = 0
      } else {
        idle++
      }
      if (steps === 0 || steps % 10 === 0) {
        NarsilPanel && NarsilPanel.log('WhatsApp: miembros detectados hasta ahora: ' + count)
      }
      var movement = this._driveScroll(container, step)
      steps++
      await this._sleep(180)
      if (!movement.moved && movement.atEnd && idle >= 3) break
    }
    this._extractParticipants(document, chat)
    return { steps: steps }
  },

  _participantScrollContainer: function (root) {
    if (!root) return null
    var candidates = [root]
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('[role="list"], [data-testid*="list" i], div') : []).forEach(function (node) {
      candidates.push(node)
    })
    var self = this
    var scored = candidates.map(function (node) {
      var score = 0
      if (self._isScrollable(node)) score += 12
      score += Math.min(self._participantNodes(node).length * 3, 24)
      var text = self._visibleText(node).slice(0, 500)
      if (/(participantes|participants|miembros|members)/i.test(text)) score += 6
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
    var last = this._lastParticipantNode(container)
    try {
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end', inline: 'nearest' })
    } catch (_) {}
    var after = container.scrollTop || 0
    return {
      moved: Math.abs(after - before) > 2,
      atEnd: (after + (container.clientHeight || 0)) >= ((container.scrollHeight || 0) - 6),
    }
  },

  _lastParticipantNode: function (root) {
    var nodes = this._participantNodes(root)
    return nodes.length ? nodes[nodes.length - 1] : null
  },

  _participantRows: function (groupName) {
    var self = this
    return Object.keys(this._contactsByKey).sort(function (a, b) {
      var pa = self._contactsByKey[a]
      var pb = self._contactsByKey[b]
      return String(pa.name || '').localeCompare(String(pb.name || ''))
    }).map(function (key) {
      return self._contactsByKey[key]
    }).filter(function (p) {
      return !groupName || !p.group || p.group === groupName
    }).map(function (p) {
      return {
        'Nombre': p.name || NarsilExport.missing('nombre no visible'),
        'Telefono': p.phone || NarsilExport.missing('telefono no visible'),
        'Rol': p.role || NarsilExport.missing(),
        'Pais': p.country || NarsilExport.missing('pais no resuelto'),
        'Grupo': p.group || NarsilExport.missing('grupo no capturado'),
        'Avatar': p.avatar_url || NarsilExport.missing(),
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
        'Telefono remitente': m.sender_phone || NarsilExport.missing('telefono no visible'),
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
      'Nombre': item.display_name || item.username || NarsilExport.missing('nombre no visible'),
      'Telefono': item.phone || NarsilExport.missing('telefono no visible'),
      'Rol': item.role || NarsilExport.missing(),
      'Pais': ns.country || NarsilExport.missing('pais no resuelto'),
      'Grupo': ns.group || NarsilExport.missing('grupo no capturado'),
      'Avatar': item.avatar_url || NarsilExport.missing(),
    }
  },

  _chatToText: function (chat, participants, messages) {
    var lines = ['WhatsApp chat report', 'Captured: ' + chat.captured_at, 'URL: ' + location.href, '']
    this._addLine(lines, 'Type', chat.type)
    this._addLine(lines, 'Title', chat.title)
    this._addLine(lines, 'Phone', chat.phone)
    this._addLine(lines, 'Subtitle', chat.subtitle)
    this._addLine(lines, 'Member count text/parsed', chat.member_count)
    this._addLine(lines, 'Avatar URL', chat.avatar_url)
    this._addBlock(lines, 'Description', chat.description)
    this._addLine(lines, 'Visible participants extracted', participants.length)
    this._addLine(lines, 'Visible messages extracted', messages.length)
    return lines.join('\n')
  },

  // --------------------------------------------------------------------------
  // Cache and schema helpers
  // --------------------------------------------------------------------------

  _rememberParticipant: function (p) {
    if (!p) return null
    var key = this._participantKey(p)
    var prev = this._contactsByKey[key] || {}
    var merged = this._merge(prev, p)
    this._contactsByKey[key] = merged
    this._add(NarsilSchema.contact('whatsapp', {
      id: merged.phone || merged.name,
      display_name: merged.name,
      phone: merged.phone,
      role: merged.role,
      avatar_url: merged.avatar_url,
      network_specific: {
        country: merged.country,
        group: merged.group,
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

  _participantKey: function (p) {
    return [p.group || '', p.phone || '', this._fold(p.name || '')].join(':')
  },

  _contactItems: function () {
    return this.collected.filter(function (item) { return item._type === 'contact' })
  },

  _add: function (item) {
    if (!item) return
    var ns = item.network_specific || {}
    var key = item._type + ':' + (ns.group ? ns.group + ':' : '') + (item.id || item.phone || item.display_name || item.url || '')
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  // --------------------------------------------------------------------------
  // Low-level helpers
  // --------------------------------------------------------------------------

  _resolveCountry: function (phone) {
    var digits = String(phone || '').replace(/\D/g, '')
    for (var len = 3; len >= 1; len--) {
      var prefix = digits.slice(0, len)
      if (this._COUNTRY_CODES[prefix]) return this._COUNTRY_CODES[prefix]
    }
    return ''
  },

  _phoneFromText: function (text) {
    text = this._clean(text)
    if (!text) return ''
    var candidates = text.match(/\+?\d[\d\s().-]{7,28}\d/g) || []
    for (var i = 0; i < candidates.length; i++) {
      var phone = this._normalizePhone(candidates[i])
      if (phone) return phone
    }
    return ''
  },

  _normalizePhone: function (value) {
    value = this._clean(value)
    if (!value) return ''
    var hasPlus = /^\s*\+/.test(value)
    var digits = value.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 16) return ''
    return (hasPlus ? '+' : '') + digits
  },

  _memberCount: function (text) {
    text = this._clean(text)
    var m = /([\d.,]+)\s*(?:participantes|participants|miembros|members)/i.exec(text)
    if (!m) return null
    var digits = m[1].replace(/[^\d]/g, '')
    return digits ? Number(digits) : null
  },

  _messageStableId: function (chat, parsed, text, idx) {
    return this._safeName([chat && chat.title, parsed.date, parsed.time, parsed.sender, text.slice(0, 24), idx].join('_')).slice(0, 160)
  },

  _links: function (root) {
    var out = []
    Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('a[href]') : []).forEach(function (a) {
      var href = a.href || a.getAttribute('href') || ''
      try {
        var u = new URL(href, location.origin)
        if (/l\.whatsapp\.net$/i.test(u.hostname) && u.searchParams.get('u')) href = u.searchParams.get('u')
      } catch (_) {}
      if (!/^https?:/i.test(href)) return
      if (out.indexOf(href) === -1) out.push(href)
    })
    return out.slice(0, 20)
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

  _firstMatchingText: function (root, pattern) {
    if (!root || !root.querySelectorAll) return ''
    var nodes = Array.prototype.slice.call(root.querySelectorAll('span, div, button'))
    for (var i = 0; i < nodes.length; i++) {
      var text = this._clean(nodes[i].innerText || nodes[i].textContent)
      if (text && text.length < 180 && pattern.test(text)) return text
    }
    return ''
  },

  _firstLongText: function (root, exclude) {
    if (!root || !root.querySelectorAll) return ''
    exclude = this._clean(exclude)
    var nodes = Array.prototype.slice.call(root.querySelectorAll('[data-testid*="about" i], span[dir], div[dir], span'))
    for (var i = 0; i < nodes.length; i++) {
      var text = this._clean(nodes[i].innerText || nodes[i].textContent)
      if (!text || text === exclude || text.length < 18 || text.length > 500) continue
      if (/(participantes|participants|miembros|members|admin|cifrado|encrypted)/i.test(text)) continue
      if (this._phoneFromText(text)) continue
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
    var safe = this._safeName(filename || 'whatsapp_report.txt')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('WhatsApp: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('WhatsApp: error de descarga - ' + e.message, 'err')
      })
  },

  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = this._safeName(filename || 'whatsapp_export.xlsx')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('WhatsApp: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('WhatsApp: error de descarga - ' + e.message, 'err')
      })
  },

  _safeName: function (value) {
    return String(value || 'whatsapp_export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
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
