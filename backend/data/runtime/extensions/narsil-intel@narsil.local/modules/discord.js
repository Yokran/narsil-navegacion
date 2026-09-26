// NARSIL Intel Collector - modules/discord.js
// Conservative Discord collector. It only uses DOM data and JSON responses that
// Discord already loaded in the page; it never reads tokens, storage or cookies.
'use strict'

NarsilModules.discord = {
  network:          'discord',
  collected:        [],
  _seen:            {},
  _users:           {},
  _guilds:          {},
  _membersByGuild:  {},
  _channelUsersByChannel: {},
  _channelsByGuild: {},

  getPageType: function () {
    var p = location.pathname || '/'
    if (/^\/channels\/@me(?:\/|$)/.test(p)) return 'dms'
    if (/^\/channels\/\d+(?:\/\d+)?\/?$/.test(p)) return 'server'
    if (/^\/guild-discovery/.test(p) || /^\/store/.test(p)) return 'sensitive'
    return 'other'
  },

  getActions: function () {
    var type = this.getPageType()
    var actions = []
    if (type === 'server') {
      actions.push({ id: 'server_report', label: 'Reporte del servidor (TXT)' })
      actions.push({ id: 'server_members', label: 'Miembros del servidor -> XLSX' })
      actions.push({ id: 'channel_users', label: 'Usuarios del canal -> XLSX' })
    } else if (type === 'dms') {
      actions.push({ id: 'captured_users', label: 'Usuarios capturados -> XLSX' })
      actions.push({ id: 'current_user', label: 'Usuario actual (TXT)' })
    } else if (type === 'sensitive') {
      actions.push({ id: 'blocked', label: 'Vista sensible: no extraer' })
    } else {
      actions.push({ id: 'captured_guilds', label: 'Servidores capturados -> XLSX' })
      actions.push({ id: 'captured_users', label: 'Usuarios capturados -> XLSX' })
    }
    return actions
  },

  runAction: function (id) {
    switch (id) {
      case 'server_report':    this._actionServerReport(); break
      case 'server_members':   this._actionServerMembers(); break
      case 'channel_users':    this._actionChannelUsers(); break
      case 'captured_users':   this._actionCapturedUsers(); break
      case 'captured_guilds':  this._actionCapturedGuilds(); break
      case 'current_user':     this._actionCurrentUser(); break
      case 'blocked':
        NarsilPanel && NarsilPanel.log('Discord: vista sensible/no soportada. No se extrae contenido.', 'err')
        break
    }
  },

  stats: function () {
    var p = 0, g = 0, c = 0
    this.collected.forEach(function (item) {
      if (item._type === 'profile') p++
      else if (item._type === 'group') g++
      else if (item._type === 'contact') c++
    })
    return { profiles: p + g, posts: 0, contacts: c }
  },

  getItems: function () { return this.collected },

  clear: function () {
    this.collected = []
    this._seen = {}
    this._users = {}
    this._guilds = {}
    this._membersByGuild = {}
    this._channelUsersByChannel = {}
    this._channelsByGuild = {}
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
    NarsilPanel && NarsilPanel.refreshActions && NarsilPanel.refreshActions()
  },

  onPageData: function () {},

  onNetworkRequest: function (url, body) {
    try {
      if (!body || typeof body !== 'object') return
      url = String(url || '')
      if (body.t && this._parseGatewayPayload(body)) return
      if (!/discord(?:app)?\.com|discord\.gg/i.test(url) && !/\/api\/v\d+\//i.test(url)) return

      if (/\/api\/v\d+\/users\/@me$/i.test(url) && body.id) {
        this._parseCurrentUser(body, 'users_me')
        return
      }

      if (/\/api\/v\d+\/users\/@me\/guilds/i.test(url) && Array.isArray(body)) {
        this._parseGuildList(body, 'users_me_guilds')
        return
      }

      var guildMatch = /\/api\/v\d+\/guilds\/(\d+)(?:\?|$)/i.exec(url)
      if (guildMatch && body.id) {
        this._parseGuild(body, 'guild_detail')
        return
      }

      var channelsMatch = /\/api\/v\d+\/guilds\/(\d+)\/channels/i.exec(url)
      if (channelsMatch && Array.isArray(body)) {
        this._parseChannels(channelsMatch[1], body, 'guild_channels')
        return
      }

      var membersMatch = /\/api\/v\d+\/guilds\/(\d+)\/members/i.exec(url)
      if (membersMatch) {
        this._parseMemberPayload(membersMatch[1], body, 'guild_members')
        return
      }

      var profileMatch = /\/api\/v\d+\/users\/(\d+)\/profile/i.exec(url)
      if (profileMatch) {
        this._parseProfilePayload(body, 'user_profile')
        return
      }

      if (/\/api\/v\d+\/users\/@me\/relationships/i.test(url) && Array.isArray(body)) {
        this._parseRelationships(body, 'relationships')
        return
      }

      if (/\/api\/v\d+\/channels\/\d+\/messages/i.test(url)) {
        var channelMatch = /\/api\/v\d+\/channels\/(\d+)\/messages/i.exec(url)
        this._parseMessages(body, 'message_author', channelMatch && channelMatch[1])
      }
    } catch (e) {
      NarsilPanel && NarsilPanel.log('Discord: error procesando respuesta pasiva - ' + e.message, 'err')
    }
  },

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  _actionServerReport: function () {
    var self = this
    var guildId = this._currentGuildId()
    if (!guildId) {
      NarsilPanel && NarsilPanel.log('Discord: abre manualmente un servidor primero.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('Discord: preparando reporte del servidor...')
    this._requestPageData(450).then(function () {
      self._extractVisibleUsersFromDom(guildId)
      var snapshot = self._serverSnapshot(guildId)
      if (!snapshot.id) {
        NarsilPanel && NarsilPanel.log('Discord: no hay datos del servidor en cache. Cambia de canal o abre la lista de miembros y reintenta.', 'err')
        return
      }
      self._add(self._guildToSchema(snapshot))
      self._sendDownload(
        'discord_server_' + snapshot.id + '.txt',
        self._serverToText(snapshot),
        'text/plain;charset=utf-8'
      )
      NarsilPanel && NarsilPanel.log('Discord: reporte del servidor descargado.', 'ok')
    })
  },

  _actionServerMembers: function () {
    var self = this
    var guildId = this._currentGuildId()
    if (!guildId) {
      NarsilPanel && NarsilPanel.log('Discord: entra manualmente en un servidor primero.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('Discord: recorriendo lista de miembros del servidor...')
    this._requestPageData(450).then(function () {
      return self._scrollServerMembers(guildId)
    }).then(function (scan) {
      return self._requestPageData(300).then(function () { return scan })
    }).then(function (scan) {
      self._extractVisibleMembersFromDom(guildId, self._findMemberScrollContainer(guildId) || document)
      var rows = self._memberRows(guildId)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Discord: no hay miembros del servidor capturados. Asegurate de que la lista lateral de miembros este visible.', 'err')
        return
      }
      rows.forEach(function (row) {
        self._add(NarsilSchema.contact('discord', {
          id: row.ID && !row.ID.__narsilMissing ? row.ID : null,
          username: row.Usuario && !row.Usuario.__narsilMissing ? row.Usuario : null,
          display_name: row.Usuario && !row.Usuario.__narsilMissing ? row.Usuario : null,
          role: 'member',
          avatar_url: row.Avatar && !row.Avatar.__narsilMissing ? row.Avatar : null,
          network_specific: {
            source: 'server_members_export',
          },
        }))
      })
      self._downloadRows('discord_members_' + guildId, rows)
      var detail = scan && scan.steps ? ' en ' + scan.steps + ' pasos' : ''
      NarsilPanel && NarsilPanel.log('Discord: ' + rows.length + ' miembros del servidor exportados' + detail + '.', 'ok')
    })
  },

  _actionChannelUsers: function () {
    var self = this
    var channelId = this._currentChannelId()
    if (!channelId) {
      NarsilPanel && NarsilPanel.log('Discord: entra en un canal del servidor primero.', 'err')
      return
    }
    NarsilPanel && NarsilPanel.log('Discord: preparando usuarios del canal...')
    this._requestPageData(450).then(function () {
      self._extractVisibleChannelUsersFromDom(channelId)
      var rows = self._channelUserRows(channelId)
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Discord: no hay usuarios capturados en este canal. Recorre mensajes visibles y reintenta.', 'err')
        return
      }
      self._downloadRows('discord_channel_users_' + channelId, rows)
      NarsilPanel && NarsilPanel.log('Discord: ' + rows.length + ' usuarios del canal exportados.', 'ok')
    })
  },

  _actionCapturedUsers: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('Discord: preparando usuarios capturados...')
    this._requestPageData(450).then(function () {
      var rows = self._userRows()
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Discord: no hay usuarios capturados todavia.', 'err')
        return
      }
      self._downloadRows('discord_users', rows)
      NarsilPanel && NarsilPanel.log('Discord: ' + rows.length + ' usuarios exportados.', 'ok')
    })
  },

  _actionCapturedGuilds: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('Discord: preparando servidores capturados...')
    this._requestPageData(450).then(function () {
      var rows = self._guildRows()
      if (!rows.length) {
        NarsilPanel && NarsilPanel.log('Discord: no hay servidores capturados todavia.', 'err')
        return
      }
      self._downloadRows('discord_servers', rows)
      NarsilPanel && NarsilPanel.log('Discord: ' + rows.length + ' servidores exportados.', 'ok')
    })
  },

  _actionCurrentUser: function () {
    var self = this
    NarsilPanel && NarsilPanel.log('Discord: preparando usuario actual...')
    this._requestPageData(450).then(function () {
      var me = Object.keys(self._users).map(function (id) { return self._users[id] }).filter(function (u) { return u.is_current })
      if (!me.length) {
        NarsilPanel && NarsilPanel.log('Discord: usuario actual no capturado en respuestas visibles.', 'err')
        return
      }
      self._sendDownload('discord_current_user.txt', self._userToText(me[0]), 'text/plain;charset=utf-8')
      NarsilPanel && NarsilPanel.log('Discord: usuario actual descargado.', 'ok')
    })
  },

  // --------------------------------------------------------------------------
  // Passive parsers
  // --------------------------------------------------------------------------

  _parseGatewayPayload: function (payload) {
    if (!payload || !payload.t || !payload.d) return false
    if (payload.t === 'GUILD_MEMBER_LIST_UPDATE') {
      this._parseGatewayMemberListUpdate(payload.d, 'gateway_member_list')
      return true
    }
    if (payload.t === 'GUILD_CREATE') {
      this._parseGatewayGuild(payload.d, 'gateway_guild_create')
      return true
    }
    if (payload.t === 'READY' || payload.t === 'READY_SUPPLEMENTAL') {
      this._parseGatewayReady(payload.d, 'gateway_ready')
      return true
    }
    return false
  },

  _parseGatewayReady: function (data, source) {
    if (!data || typeof data !== 'object') return
    var self = this
    if (data.user) this._parseCurrentUser(data.user, source)
    ;(data.guilds || []).forEach(function (g) { self._parseGuild(g, source) })
    ;(data.users || []).forEach(function (u) { self._cacheUser(u, source) })
  },

  _parseGatewayGuild: function (guild, source) {
    if (!guild || !guild.id) return
    this._parseGuild(guild, source)
    if (Array.isArray(guild.channels)) this._parseChannels(String(guild.id), guild.channels, source)
    if (Array.isArray(guild.members)) this._parseMemberPayload(String(guild.id), guild.members, source)
  },

  _parseGatewayMemberListUpdate: function (data, source) {
    if (!data || !data.guild_id || !Array.isArray(data.ops)) return
    var guildId = String(data.guild_id)
    var self = this
    if (Array.isArray(data.groups)) {
      var counted = 0
      data.groups.forEach(function (g) {
        if (g && g.count != null && !isNaN(Number(g.count))) counted += Number(g.count)
      })
      if (counted > 0) {
        var prevGuild = this._guilds[guildId] || { id: guildId, url: 'https://discord.com/channels/' + guildId }
        this._guilds[guildId] = this._merge(this._guilds[guildId] || { id: guildId, url: 'https://discord.com/channels/' + guildId }, {
          member_count: prevGuild.member_count || counted,
          source: this._appendSource(this._guilds[guildId] && this._guilds[guildId].source, source),
        })
      }
    }
    data.ops.forEach(function (op) {
      if (!op) return
      if (op.item) self._parseGatewayMemberListItem(guildId, op.item, source)
      ;(op.items || []).forEach(function (item) { self._parseGatewayMemberListItem(guildId, item, source) })
    })
  },

  _parseGatewayMemberListItem: function (guildId, item, source) {
    if (!item || typeof item !== 'object') return
    if (item.member) {
      this._parseMember(guildId, item.member, source)
    } else if (item.user) {
      this._parseMember(guildId, { user: item.user, roles: item.roles || [] }, source)
    }
  },

  _parseCurrentUser: function (u, source) {
    var cached = this._cacheUser(u, source)
    if (!cached) return
    cached.is_current = true
    this._add(NarsilSchema.profile('discord', {
      id: cached.id,
      username: cached.username,
      display_name: cached.display_name,
      bio: cached.bio,
      avatar_url: cached.avatar_url,
      verified: cached.verified,
      url: cached.url,
      network_specific: {
        discriminator: cached.discriminator,
        bot: cached.bot,
        public_flags: cached.public_flags,
        premium_type: u.premium_type,
        mfa_enabled: u.mfa_enabled,
        source: source,
      },
    }))
  },

  _parseGuildList: function (items, source) {
    var self = this
    items.forEach(function (guild) { self._parseGuild(guild, source) })
  },

  _parseGuild: function (g, source) {
    if (!g || !g.id) return null
    var id = String(g.id)
    var prev = this._guilds[id] || {}
    this._guilds[id] = this._merge(prev, {
      id: id,
      name: this._text(g.name) || prev.name,
      description: this._text(g.description) || prev.description,
      member_count: this._firstNumber(g.approximate_member_count, g.member_count, g.members_count, prev.member_count),
      owner_id: this._text(g.owner_id) || prev.owner_id,
      icon_url: this._guildIconUrl(g) || prev.icon_url,
      features: Array.isArray(g.features) ? g.features : prev.features,
      premium_tier: g.premium_tier != null ? g.premium_tier : prev.premium_tier,
      source: this._appendSource(prev.source, source),
      url: 'https://discord.com/channels/' + id,
    })
    this._add(this._guildToSchema(this._guilds[id]))
    return this._guilds[id]
  },

  _parseChannels: function (guildId, channels, source) {
    if (!guildId || !Array.isArray(channels)) return
    var map = this._channelsByGuild[guildId] || {}
    channels.forEach(function (ch) {
      if (!ch || !ch.id) return
      map[String(ch.id)] = {
        id: String(ch.id),
        name: ch.name || null,
        type: ch.type,
        parent_id: ch.parent_id || null,
        source: source,
      }
    })
    this._channelsByGuild[guildId] = map
  },

  _parseMemberPayload: function (guildId, body, source) {
    var members = this._extractMemberCandidates(body)
    var self = this
    members.forEach(function (member) { self._parseMember(guildId, member, source) })
  },

  _parseMember: function (guildId, member, source) {
    if (!member || typeof member !== 'object') return null
    var u = member.user || member
    var cached = this._cacheUser(u, source)
    if (!cached || !cached.id) return null

    guildId = String(guildId || member.guild_id || this._currentGuildId() || '')
    if (!guildId) return cached

    var members = this._membersByGuild[guildId] || {}
    var prev = members[cached.id] || {}
    var roles = Array.isArray(member.roles) ? member.roles.map(String) : (prev.roles || [])
    members[cached.id] = this._merge(prev, {
      id: cached.id,
      guild_id: guildId,
      username: cached.username,
      display_name: cached.display_name,
      nick: this._text(member.nick) || prev.nick,
      roles: roles,
      joined_at: member.joined_at || prev.joined_at,
      premium_since: member.premium_since || prev.premium_since,
      pending: member.pending != null ? !!member.pending : prev.pending,
      avatar_url: this._memberAvatarUrl(guildId, member, cached) || cached.avatar_url || prev.avatar_url,
      bot: cached.bot,
      source: this._appendSource(prev.source, source),
    })
    this._membersByGuild[guildId] = members
    this._add(NarsilSchema.contact('discord', {
      id: cached.id,
      username: cached.username,
      display_name: members[cached.id].nick || cached.display_name,
      role: 'member',
      avatar_url: members[cached.id].avatar_url,
      network_specific: {
        guild_id: guildId,
        guild_name: (this._guilds[guildId] && this._guilds[guildId].name) || null,
        nick: members[cached.id].nick,
        roles: roles,
        joined_at: members[cached.id].joined_at,
        source: source,
      },
    }))
    return members[cached.id]
  },

  _parseProfilePayload: function (body, source) {
    if (body.user) this._cacheUser(body.user, source)
    if (body.user_profile && body.user_profile.bio && body.user && body.user.id) {
      this._users[String(body.user.id)].bio = this._text(body.user_profile.bio)
    }
    if (Array.isArray(body.mutual_guilds)) {
      var self = this
      body.mutual_guilds.forEach(function (g) { self._parseGuild(g, 'mutual_guilds') })
    }
  },

  _parseRelationships: function (items, source) {
    var self = this
    items.forEach(function (rel) {
      if (!rel || !rel.user) return
      var u = self._cacheUser(rel.user, source)
      if (!u) return
      self._add(NarsilSchema.contact('discord', {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        role: rel.type === 1 ? 'friend' : 'relationship_' + String(rel.type || 'unknown'),
        avatar_url: u.avatar_url,
        network_specific: { source: source, relationship_type: rel.type },
      }))
    })
  },

  _parseMessages: function (body, source, channelId) {
    var messages = Array.isArray(body) ? body : (body && body.messages) || []
    var self = this
    channelId = String(channelId || this._currentChannelId() || '')
    messages.forEach(function (msg) {
      if (!msg || !msg.author) return
      self._markChannelUser(channelId, msg.author, source)
    })
  },

  _markChannelUser: function (channelId, u, source) {
    if (!channelId || !u || !u.id) return null
    var cached = this._cacheUser(u, source)
    if (!cached) return null
    var map = this._channelUsersByChannel[channelId] || {}
    var prev = map[cached.id] || {}
    map[cached.id] = this._merge(prev, {
      id: cached.id,
      channel_id: String(channelId),
      username: cached.username,
      display_name: cached.display_name,
      avatar_url: cached.avatar_url,
      bot: cached.bot,
      source: this._appendSource(prev.source, source),
    })
    this._channelUsersByChannel[channelId] = map
    this._add(NarsilSchema.contact('discord', {
      id: cached.id,
      username: cached.username,
      display_name: cached.display_name,
      role: 'channel_user',
      avatar_url: cached.avatar_url,
      network_specific: { channel_id: String(channelId), source: source },
    }))
    return map[cached.id]
  },

  _cacheUser: function (u, source) {
    if (!u || !u.id) return null
    var id = String(u.id)
    var prev = this._users[id] || {}
    this._users[id] = this._merge(prev, {
      id: id,
      username: this._text(u.username) || prev.username,
      display_name: this._text(u.global_name || u.display_name || u.name) || prev.display_name || this._text(u.username),
      discriminator: this._text(u.discriminator) || prev.discriminator,
      avatar_url: this._userAvatarUrl(u) || this._text(u.avatar_url) || prev.avatar_url,
      banner_url: this._userBannerUrl(u) || prev.banner_url,
      bot: u.bot != null ? !!u.bot : prev.bot,
      verified: u.verified != null ? !!u.verified : prev.verified,
      public_flags: u.public_flags != null ? u.public_flags : prev.public_flags,
      bio: this._text(u.bio) || prev.bio,
      source: this._appendSource(prev.source, source),
      url: 'https://discord.com/users/' + id,
    })
    return this._users[id]
  },

  // --------------------------------------------------------------------------
  // DOM fallback
  // --------------------------------------------------------------------------

  _extractVisibleMembersFromDom: function (guildId, root) {
    var self = this
    var seen = {}
    root = root || document
    var before = Object.keys(this._membersByGuild[String(guildId)] || {}).length
    var selectors = [
      'a[href*="/users/"]',
      '[data-user-id]',
      '[data-list-item-id*="members"]',
      '[data-list-item-id*="member"]',
      '[id*="members-"]',
    ].join(',')
    var nodes = Array.prototype.slice.call(root.querySelectorAll(selectors))
    nodes.forEach(function (node) {
      var candidate = self._domMemberCandidate(node, guildId)
      var seenKey = candidate && (candidate.key || candidate.id)
      if (!candidate || !seenKey || seen[seenKey]) return
      seen[seenKey] = true
      var parsed = self._splitDisplayAndUsername(candidate.label)
      var username = parsed.username || candidate.id || candidate.key
      var display = parsed.display_name || parsed.username || candidate.label || candidate.id || candidate.key
      self._storeDomMember(guildId, candidate, {
        username: username,
        display_name: display,
        nick: parsed.nick || display,
      })
    })
    var after = Object.keys(this._membersByGuild[String(guildId)] || {}).length
    if (!Object.keys(seen).length && nodes.length && NarsilPanel) {
      NarsilPanel.log('Discord debug: filas de miembros no aceptadas: ' + nodes.slice(0, 3).map(function (node) {
        return (node.getAttribute && (node.getAttribute('data-list-item-id') || node.getAttribute('id') || node.getAttribute('data-user-id'))) || node.tagName || '?'
      }).join(' | '), 'err')
    }
    return { nodes: nodes.length, accepted: Object.keys(seen).length, added: Math.max(0, after - before) }
  },

  _extractVisibleUsersFromDom: function (guildId) {
    this._extractVisibleMembersFromDom(guildId, document)
  },

  _storeDomMember: function (guildId, candidate, parsed) {
    if (!guildId || !candidate) return null
    var key = candidate.id || candidate.key
    if (!key) return null

    var username = parsed.username || parsed.display_name || candidate.label || candidate.id || candidate.key
    var display = parsed.display_name || parsed.username || candidate.label || username
    var cached = null
    if (candidate.id) {
      cached = this._cacheUser({
        id: candidate.id,
        username: username,
        global_name: display,
        avatar_url: candidate.avatar_url,
      }, candidate.source)
    }

    var members = this._membersByGuild[guildId] || {}
    var prev = members[key] || {}
    members[key] = this._merge(prev, {
      id: candidate.id || prev.id || null,
      key: key,
      guild_id: String(guildId),
      username: (cached && cached.username) || username,
      display_name: (cached && cached.display_name) || display,
      nick: parsed.nick || prev.nick || display,
      roles: prev.roles || [],
      avatar_url: candidate.avatar_url || (cached && cached.avatar_url) || prev.avatar_url,
      bot: cached ? cached.bot : prev.bot,
      list_item_id: candidate.list_item_id || prev.list_item_id,
      source: this._appendSource(prev.source, candidate.source || 'dom_visible_member'),
    })
    this._membersByGuild[guildId] = members

    this._add(NarsilSchema.contact('discord', {
      id: candidate.id || null,
      username: members[key].username,
      display_name: members[key].nick || members[key].display_name,
      role: 'member',
      avatar_url: members[key].avatar_url,
      network_specific: {
        guild_id: String(guildId),
        guild_name: (this._guilds[guildId] && this._guilds[guildId].name) || null,
        list_item_id: candidate.list_item_id,
        source: candidate.source || 'dom_visible_member',
      },
    }))
    return members[key]
  },

  _extractVisibleChannelUsersFromDom: function (channelId) {
    var self = this
    channelId = String(channelId || this._currentChannelId() || '')
    if (!channelId) return
    var selectors = [
      '[id^="chat-messages-"]',
      '[data-list-item-id^="chat-messages"]',
      '[role="article"]',
      '[data-author-id]',
    ].join(',')
    Array.prototype.slice.call(document.querySelectorAll(selectors)).forEach(function (node) {
      var candidate = self._domChannelUserCandidate(node)
      if (!candidate || !candidate.id) return
      self._markChannelUser(channelId, {
        id: candidate.id,
        username: candidate.username || candidate.label || candidate.id,
        global_name: candidate.display_name || candidate.label || candidate.username,
      }, candidate.source)
    })
  },

  _domChannelUserCandidate: function (node) {
    if (!node || !node.getAttribute) return null
    var attrs = [
      node.getAttribute('data-author-id'),
      node.getAttribute('id'),
      node.getAttribute('data-list-item-id'),
      node.getAttribute('aria-labelledby'),
      node.getAttribute('aria-describedby'),
    ].filter(Boolean).join(' ')
    var idMatch = attrs.match(/\d{15,25}/g)
    var id = idMatch && idMatch.length ? idMatch[idMatch.length - 1] : null
    var authorNode = node.querySelector && node.querySelector('[data-author-id]')
    if (!id && authorNode) id = authorNode.getAttribute('data-author-id')
    var userLink = node.querySelector && node.querySelector('a[href*="/users/"]')
    if (!id && userLink) {
      var hrefMatch = /\/users\/(\d{15,25})/.exec(userLink.getAttribute('href') || '')
      if (hrefMatch) id = hrefMatch[1]
    }
    if (!id) return null

    var label = this._domMemberLabel(node)
    var parsed = this._splitDisplayAndUsername(label)
    return {
      id: id,
      username: parsed.username,
      display_name: parsed.display_name,
      label: label,
      source: 'dom_channel_user',
    }
  },

  _domMemberCandidate: function (node, currentGuildId) {
    if (!node || !node.getAttribute) return null
    var dataListId = node.getAttribute('data-list-item-id') || ''
    var directList = this._candidateFromMemberListItem(node, currentGuildId, dataListId)
    if (directList) return directList

    var attrs = [
      node.getAttribute('data-user-id'),
      dataListId,
      node.getAttribute('id'),
      node.getAttribute('href'),
      node.getAttribute('aria-controls'),
      node.getAttribute('aria-describedby'),
    ].filter(Boolean).join(' ')

    var directUser = /\/users\/(\d{15,25})/.exec(attrs)
    var dataUser = node.getAttribute('data-user-id')
    var avatar = this._domAvatarInfo(node)
    var userId = (dataUser && /^\d{15,25}$/.test(dataUser)) ? dataUser : (directUser && directUser[1]) || (avatar && avatar.id)
    var listMatch = /members?-?(\d{15,25})?[_:-]{2,}([A-Za-z0-9_-]+)/i.exec(dataListId)
    var attrGuildId = listMatch && listMatch[1]
    var listIndex = listMatch && listMatch[2]
    if (!userId) {
      var ids = attrs.match(/\d{15,25}/g) || []
      if (!/members?/i.test(dataListId) && ids.length) userId = ids[ids.length - 1]
      if (ids.length > 1 && /members?/i.test(dataListId)) attrGuildId = attrGuildId || ids[0]
    }
    if (currentGuildId && attrGuildId && String(attrGuildId) !== String(currentGuildId)) return null

    var key = userId || (dataListId ? 'dom:' + dataListId : null)
    if (!key) return null

    var label = this._domMemberLabel(node)
    return {
      id: userId || null,
      key: key,
      list_item_id: dataListId || null,
      list_index: listIndex || null,
      label: label || userId || listIndex || key,
      avatar_url: avatar && avatar.url,
      source: 'dom_visible_member',
    }
  },

  _candidateFromMemberListItem: function (node, currentGuildId, dataListId) {
    if (!dataListId || !/^members-/i.test(dataListId)) return null
    var prefix = /^members-(\d{8,30})___(.+)$/i.exec(dataListId)
    if (!prefix) prefix = /^members-(\d{8,30})[-_:]+(.+)$/i.exec(dataListId)
    if (!prefix) return null
    var guildId = prefix[1]
    var guildMismatch = currentGuildId && String(guildId) !== String(currentGuildId)

    var avatar = this._domAvatarInfo(node)
    var label = this._domMemberLabel(node)
    return {
      id: avatar && avatar.id || null,
      key: avatar && avatar.id || ('dom:' + dataListId),
      list_item_id: dataListId,
      list_index: prefix[2],
      label: label || (avatar && avatar.id) || prefix[2] || dataListId,
      avatar_url: avatar && avatar.url,
      source: (avatar && avatar.id ? 'dom_visible_member_avatar_id' : 'dom_visible_member_virtual_row') + (guildMismatch ? '_guild_mismatch' : ''),
    }
  },

  _domAvatarInfo: function (node) {
    if (!node || !node.querySelectorAll) return null
    var values = []
    Array.prototype.slice.call(node.querySelectorAll('img[src], [style*="background"]')).forEach(function (el) {
      if (el.currentSrc) values.push(el.currentSrc)
      if (el.src) values.push(el.src)
      if (el.getAttribute) {
        values.push(el.getAttribute('src') || '')
        values.push(el.getAttribute('style') || '')
      }
    })
    for (var i = 0; i < values.length; i++) {
      var value = String(values[i] || '')
      var match = /\/(?:avatars|users)\/(\d{15,25})\//i.exec(value) || /\/guilds\/\d{15,25}\/users\/(\d{15,25})\/avatars\//i.exec(value)
      if (match) return { id: match[1], url: value.match(/https?:\/\/[^"')\s]+/i)?.[0] || value }
    }
    return null
  },

  _domMemberLabel: function (node) {
    var values = []
    function add(value) {
      value = String(value || '').replace(/\s+/g, ' ').trim()
      if (value) values.push(value)
    }
    add(node.getAttribute && node.getAttribute('aria-label'))
    add(node.getAttribute && node.getAttribute('title'))
    var labelled = node.querySelector && node.querySelector('[aria-label]')
    if (labelled) add(labelled.getAttribute('aria-label'))
    var named = node.querySelector && node.querySelector('[data-text-variant], [class*="username"], [class*="name"]')
    if (named) add(named.textContent)
    add(node.textContent)

    var label = values.filter(function (value) {
      return value && !/^\d+$/.test(value) && !/^members?-?\d/i.test(value)
    })[0] || ''
    label = label
      .replace(/\b(online|idle|offline|invisible|do not disturb|streaming)\b/ig, ' ')
      .replace(/\b(en linea|conectado|ausente|desconectado|invisible|no molestar|transmitiendo)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (label.indexOf(',') !== -1) label = label.split(',')[0].trim()
    return label
  },

  _splitDisplayAndUsername: function (label) {
    label = this._clean(label || '')
    if (!label) return { username: null, display_name: null, nick: null }
    var atMatch = /@([A-Za-z0-9_.-]{2,32})/.exec(label)
    var display = label.replace(/@([A-Za-z0-9_.-]{2,32})/g, '').trim()
    var parts = display.split(/\s{2,}|\n/).map(function (p) { return p.trim() }).filter(Boolean)
    display = parts[0] || display || label
    return {
      username: atMatch ? atMatch[1] : display,
      display_name: display,
      nick: display,
    }
  },

  // --------------------------------------------------------------------------
  // Rows / reports
  // --------------------------------------------------------------------------

  _serverSnapshot: function (guildId) {
    guildId = String(guildId || '')
    var g = this._guilds[guildId] || { id: guildId, url: guildId ? 'https://discord.com/channels/' + guildId : null }
    var members = this._membersByGuild[guildId] || {}
    var channels = this._channelsByGuild[guildId] || {}
    return this._merge(g, {
      id: guildId,
      cached_members: Object.keys(members).length,
      cached_channels: Object.keys(channels).length,
      current_channel_id: this._currentChannelId(),
    })
  },

  _memberRows: function (guildId) {
    guildId = String(guildId || '')
    var members = this._membersByGuild[guildId] || {}
    return Object.keys(members).sort(function (a, b) {
      var ma = members[a].nick || members[a].display_name || members[a].username || ''
      var mb = members[b].nick || members[b].display_name || members[b].username || ''
      return ma.localeCompare(mb)
    }).map(function (id) {
      var m = members[id]
      return {
        'ID': m.id || NarsilExport.missing('id no capturado'),
        'Usuario': m.username || NarsilExport.missing('usuario no capturado'),
        'Avatar': m.avatar_url || NarsilExport.missing(),
      }
    })
  },

  _channelUserRows: function (channelId) {
    channelId = String(channelId || '')
    var users = this._channelUsersByChannel[channelId] || {}
    return Object.keys(users).sort(function (a, b) {
      var ua = users[a].display_name || users[a].username || ''
      var ub = users[b].display_name || users[b].username || ''
      return ua.localeCompare(ub)
    }).map(function (id) {
      var u = users[id]
      return {
        'ID': id,
        'Usuario': u.username || NarsilExport.missing(),
        'Nombre': u.display_name || NarsilExport.missing(),
        'Canal ID': channelId || NarsilExport.missing('canal no capturado'),
        'Bot': u.bot == null ? NarsilExport.missing() : String(!!u.bot),
        'Avatar': u.avatar_url || NarsilExport.missing(),
        'Perfil': 'https://discord.com/users/' + id,
        'Fuente': u.source || NarsilExport.missing(),
      }
    })
  },

  _userRows: function () {
    var users = this._users
    return Object.keys(users).sort(function (a, b) {
      var ua = users[a].display_name || users[a].username || ''
      var ub = users[b].display_name || users[b].username || ''
      return ua.localeCompare(ub)
    }).map(function (id) {
      var u = users[id]
      return {
        'ID': id,
        'Usuario': u.username || NarsilExport.missing(),
        'Nombre': u.display_name || NarsilExport.missing(),
        'Discriminador': u.discriminator || NarsilExport.missing(),
        'Bot': u.bot == null ? NarsilExport.missing() : String(!!u.bot),
        'Avatar': u.avatar_url || NarsilExport.missing(),
        'Perfil': u.url || ('https://discord.com/users/' + id),
        'Fuente': u.source || NarsilExport.missing(),
      }
    })
  },

  _guildRows: function () {
    var guilds = this._guilds
    var channels = this._channelsByGuild
    return Object.keys(guilds).sort(function (a, b) {
      return String(guilds[a].name || '').localeCompare(String(guilds[b].name || ''))
    }).map(function (id) {
      var g = guilds[id]
      return {
        'ID': id,
        'Nombre': g.name || NarsilExport.missing(),
        'Descripcion': g.description || NarsilExport.missing(),
        'Miembros': g.member_count == null ? NarsilExport.missing() : String(g.member_count),
        'Owner ID': g.owner_id || NarsilExport.missing(),
        'Canales capturados': channels[id] ? String(Object.keys(channels[id]).length) : '0',
        'URL': g.url || ('https://discord.com/channels/' + id),
        'Icono': g.icon_url || NarsilExport.missing(),
        'Features': Array.isArray(g.features) && g.features.length ? g.features.join(', ') : NarsilExport.missing(),
      }
    })
  },

  _serverToText: function (s) {
    var lines = ['Discord server report', 'Captured: ' + new Date().toISOString(), 'URL: ' + location.href, '']
    this._addLine(lines, 'Server ID', s.id)
    this._addLine(lines, 'Name', s.name)
    this._addLine(lines, 'Description', s.description)
    this._addLine(lines, 'Owner ID', s.owner_id)
    this._addLine(lines, 'Member count', s.member_count)
    this._addLine(lines, 'Cached members', s.cached_members)
    this._addLine(lines, 'Cached channels', s.cached_channels)
    this._addLine(lines, 'Current channel ID', s.current_channel_id)
    this._addLine(lines, 'Icon URL', s.icon_url)
    if (Array.isArray(s.features) && s.features.length) this._addLine(lines, 'Features', s.features.join(', '))
    return lines.join('\n')
  },

  _userToText: function (u) {
    var lines = ['Discord user report', 'Captured: ' + new Date().toISOString(), '']
    this._addLine(lines, 'User ID', u.id)
    this._addLine(lines, 'Username', u.username)
    this._addLine(lines, 'Display name', u.display_name)
    this._addLine(lines, 'Bio', u.bio)
    this._addLine(lines, 'Avatar URL', u.avatar_url)
    this._addLine(lines, 'Banner URL', u.banner_url)
    this._addLine(lines, 'Bot', u.bot == null ? '' : String(!!u.bot))
    this._addLine(lines, 'Source', u.source)
    return lines.join('\n')
  },

  _guildToSchema: function (g) {
    return NarsilSchema.group('discord', {
      id: g.id,
      name: g.name,
      description: g.description,
      member_count: g.member_count,
      url: g.url || (g.id ? 'https://discord.com/channels/' + g.id : null),
      network_specific: {
        owner_id: g.owner_id,
        icon: g.icon_url,
        features: g.features,
        premium_tier: g.premium_tier,
        cached_members: g.cached_members,
        cached_channels: g.cached_channels,
        source: g.source,
      },
    })
  },

  _scrollServerMembers: async function (guildId) {
    var candidates = this._memberScrollCandidates(guildId)
    if (!candidates.length) {
      this._extractVisibleMembersFromDom(guildId, document)
      NarsilPanel && NarsilPanel.log('Discord: no se localizo contenedor de miembros; usando miembros visibles.', 'err')
      return { steps: 0, foundContainer: false }
    }

    var self = this
    var initialCount = Object.keys(this._membersByGuild[String(guildId)] || {}).length
    var best = { steps: 0, foundContainer: true, added: 0, moved: 0 }

    for (var c = 0; c < Math.min(candidates.length, 5); c++) {
      var result = await this._scanMemberContainer(guildId, candidates[c], c)
      if (result.added > best.added || result.moved > best.moved) best = result
      var totalNow = Object.keys(self._membersByGuild[String(guildId)] || {}).length
      if (result.added >= 10 || totalNow - initialCount >= 25) break
    }

    this._extractVisibleMembersFromDom(guildId, candidates[0] || document)
    return best
  },

  _scanMemberContainer: async function (guildId, container, index) {
    var self = this
    var idle = 0
    var prevCount = -1
    var steps = 0
    var moved = 0
    var startCount = Object.keys(this._membersByGuild[String(guildId)] || {}).length
    var maxSteps = 95
    var delay = 240
    var step = Math.max(260, Math.floor((container.clientHeight || 700) * 0.85))

    if (index === 0) {
      var visible = this._visibleMemberNodeCount(container)
      var listId = (container.getAttribute && container.getAttribute('data-list-id')) || ''
      NarsilPanel && NarsilPanel.log('Discord: lista de miembros localizada; list=' + (listId || 'sin-id') + ', visibles=' + visible + ', scroll=' + (container.scrollHeight || 0) + '/' + (container.clientHeight || 0))
    }

    try { container.scrollTop = 0 } catch (_) {}
    this._driveMemberScroll(container, -999999)
    await this._sleep(250)

    while (steps < maxSteps && idle < 14) {
      var domScan = self._extractVisibleMembersFromDom(guildId, container)
      await self._requestPageData(120)

      var count = Object.keys(self._membersByGuild[String(guildId)] || {}).length
      if (count > prevCount) {
        prevCount = count
        idle = 0
      } else {
        idle++
      }

      if (steps === 0 || (steps > 0 && steps % 10 === 0)) {
        NarsilPanel && NarsilPanel.log('Discord: miembros detectados hasta ahora: ' + count + ' (filas DOM=' + (domScan && domScan.nodes || 0) + ', aceptadas=' + (domScan && domScan.accepted || 0) + ')')
      }

      var movement = this._driveMemberScroll(container, step)
      if (movement.moved) moved++
      steps++
      await this._sleep(delay)
      if (!movement.moved && movement.atEnd && idle >= 3) break
    }

    this._extractVisibleMembersFromDom(guildId, container)
    var endCount = Object.keys(this._membersByGuild[String(guildId)] || {}).length
    return { steps: steps, foundContainer: true, added: Math.max(0, endCount - startCount), moved: moved }
  },

  _findMemberScrollContainer: function (guildId) {
    var candidates = this._memberScrollCandidates(guildId)
    return candidates[0] || null
  },

  _memberScrollCandidates: function (guildId) {
    var self = this
    var candidates = []
    function add(node) {
      if (node && node.querySelectorAll && candidates.indexOf(node) === -1) candidates.push(node)
    }

    var exact = []
    var exactSelector = '[data-list-id="members-' + String(guildId || '').replace(/"/g, '') + '"]'
    if (guildId) {
      Array.prototype.slice.call(document.querySelectorAll(exactSelector)).forEach(function (node) { exact.push(node) })
    }
    Array.prototype.slice.call(document.querySelectorAll('[data-list-id^="members-"]')).forEach(function (node) {
      if (exact.indexOf(node) === -1) exact.push(node)
    })

    exact.forEach(function (node) {
      add(node)
      var aside = node.closest && node.closest('aside')
      if (aside) add(aside)
    })

    if (candidates.length) {
      return candidates.map(function (node) {
        if (node.getAttribute && /^members-/.test(node.getAttribute('data-list-id') || '')) return node
        var list = node.querySelector && node.querySelector('[data-list-id^="members-"]')
        return list || node
      }).filter(function (node, idx, arr) {
        return node && arr.indexOf(node) === idx
      })
    }

    var selectors = [
      '[data-list-id*="members"]',
      '[data-list-id*="member"]',
      '[aria-label*="Members" i]',
      '[aria-label*="Miembros" i]',
      '[class*="members"]',
      '[class*="Members"]',
      'aside',
    ]

    selectors.forEach(function (selector) {
      Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (node) {
        add(node)
        Array.prototype.slice.call(node.querySelectorAll('[data-list-id*="members"], [data-list-id*="member"], [role="list"], [class*="scroller"], [class*="members"], [class*="Members"]')).forEach(function (child) {
          add(child)
        })
      })
    })

    Array.prototype.slice.call(document.querySelectorAll('[data-list-item-id*="members"], [data-list-item-id*="member"], [data-user-id], a[href*="/users/"]')).forEach(function (node) {
      var cursor = node
      var hops = 0
      while (cursor && cursor !== document.body && hops < 10) {
        add(cursor)
        if (self._isScrollable(cursor)) add(cursor)
        if (cursor.tagName && cursor.tagName.toLowerCase() === 'aside') break
        cursor = cursor.parentElement
        hops++
      }
    })

    var scored = []
    candidates.forEach(function (node) {
      if (!node || !node.querySelectorAll) return
      var score = self._scoreMemberScroller(node, guildId)
      if (score > 0) scored.push({ node: node, score: score })
    })
    scored.sort(function (a, b) { return b.score - a.score })
    return scored.map(function (entry) {
      var node = entry.node
      if (!self._isScrollable(node)) {
        var scrollable = self._bestScrollableDescendant(node, guildId)
        if (scrollable) node = scrollable
      }
      return node
    }).filter(function (node, idx, arr) {
      return node && arr.indexOf(node) === idx
    })
  },

  _scoreMemberScroller: function (node, guildId) {
    if (!node || !node.querySelectorAll) return 0
    var score = 0
    var text = [
      node.getAttribute && node.getAttribute('aria-label'),
      node.getAttribute && node.getAttribute('data-list-id'),
      node.getAttribute && node.getAttribute('data-list-item-id'),
      typeof node.className === 'string' ? node.className : '',
    ].filter(Boolean).join(' ')
    if (/members|miembros/i.test(text)) score += 12
    if (/^members-/i.test((node.getAttribute && node.getAttribute('data-list-id')) || '')) score += 40
    if (/scroller|list/i.test(text)) score += 4
    if (guildId && new RegExp(String(guildId)).test(text)) score += 6

    var items = this._visibleMemberNodeCount(node)
    score += Math.min(items * 2, 20)
    if (this._isScrollable(node)) score += 14

    try {
      var rect = node.getBoundingClientRect()
      if (rect.height > 180) score += 4
      if (rect.width >= 120 && rect.width <= 420) score += 3
      if (rect.left > window.innerWidth * 0.45) score += 4
      if (rect.top < window.innerHeight * 0.35) score += 2
    } catch (_) {}
    return score
  },

  _visibleMemberNodeCount: function (root) {
    if (!root || !root.querySelectorAll) return 0
    return root.querySelectorAll('[data-list-item-id^="members-"], [data-list-item-id*="member"], [data-user-id], a[href*="/users/"]').length
  },

  _driveMemberScroll: function (container, step) {
    var before = container.scrollTop || 0
    var delta = step || Math.max(400, Math.floor((container.clientHeight || 700) * 0.85))
    try {
      if (typeof container.scrollBy === 'function') container.scrollBy({ top: delta, left: 0, behavior: 'auto' })
    } catch (_) {}
    try { container.scrollTop = Math.max(0, Math.min(container.scrollHeight || 0, (container.scrollTop || 0) + delta)) } catch (_) {}
    try { container.dispatchEvent(new Event('scroll', { bubbles: true })) } catch (_) {}
    try {
      var wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: delta, deltaMode: 0 })
      container.dispatchEvent(wheel)
      var target = this._lastVisibleMemberNode(container) || container
      if (target !== container) target.dispatchEvent(wheel)
    } catch (_) {}
    try {
      if (!container.getAttribute('tabindex')) container.setAttribute('tabindex', '-1')
      container.focus({ preventScroll: true })
      container.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: delta >= 0 ? 'PageDown' : 'PageUp', code: delta >= 0 ? 'PageDown' : 'PageUp' }))
    } catch (_) {}
    try {
      var last = delta >= 0 ? this._lastVisibleMemberNode(container) : this._firstVisibleMemberNode(container)
      if (last && last.scrollIntoView) last.scrollIntoView({ block: delta >= 0 ? 'end' : 'start', inline: 'nearest' })
    } catch (_) {}
    var after = container.scrollTop || 0
    return {
      moved: Math.abs(after - before) > 2,
      before: before,
      after: after,
      atEnd: (after + (container.clientHeight || 0)) >= ((container.scrollHeight || 0) - 6),
    }
  },

  _firstVisibleMemberNode: function (root) {
    var nodes = this._memberNodes(root)
    return nodes[0] || null
  },

  _lastVisibleMemberNode: function (root) {
    var nodes = this._memberNodes(root)
    return nodes.length ? nodes[nodes.length - 1] : null
  },

  _memberNodes: function (root) {
    if (!root || !root.querySelectorAll) return []
    return Array.prototype.slice.call(root.querySelectorAll('[data-list-item-id^="members-"], [data-list-item-id*="member"], [data-user-id], a[href*="/users/"]')).filter(function (node) {
      try {
        var rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      } catch (_) {
        return true
      }
    })
  },

  _bestScrollableDescendant: function (node, guildId) {
    var self = this
    var best = null
    var bestScore = -1
    Array.prototype.slice.call(node.querySelectorAll('*')).forEach(function (child) {
      if (!self._isScrollable(child)) return
      var score = self._scoreMemberScroller(child, guildId)
      if (score > bestScore) {
        best = child
        bestScore = score
      }
    })
    return best
  },

  _isScrollable: function (node) {
    if (!node) return false
    return node.scrollHeight > node.clientHeight + 10
  },

  _scrollableDescendant: function (node) {
    var all = Array.prototype.slice.call(node.querySelectorAll('*'))
    for (var i = 0; i < all.length; i++) {
      if (this._isScrollable(all[i])) return all[i]
    }
    return null
  },

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  _requestPageData: function (delayMs) {
    try { window.postMessage({ __narsil_cmd: 'EXTRACT_PAGE_DATA' }, '*') } catch (_) {}
    return new Promise(function (resolve) { setTimeout(resolve, delayMs || 350) })
  },

  _sleep: function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms || 0) })
  },

  _downloadRows: function (prefix, rows) {
    var bytes = NarsilExport.toXLSX(rows)
    if (!bytes) return
    var b64 = NarsilExport.uint8ToBase64(bytes)
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    this._sendDownloadBinary(
      prefix + '_' + ts + '.xlsx',
      b64,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  },

  _safeFilename: function (filename) {
    return String(filename || 'discord_export')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
  },

  _sendDownload: function (filename, content, mimeType) {
    var safe = this._safeFilename(filename || 'discord_export.txt')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: content, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('Discord: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('Discord: error de descarga - ' + e.message, 'err')
      })
  },

  _sendDownloadBinary: function (filename, base64, mimeType) {
    var safe = this._safeFilename(filename || 'discord_export.xlsx')
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: safe, content: base64, base64: true, mimeType: mimeType })
      .then(function (res) {
        if (res && res.ok === false) NarsilPanel && NarsilPanel.log('Discord: error de descarga - ' + (res.error || 'desconocido'), 'err')
      }).catch(function (e) {
        NarsilPanel && NarsilPanel.log('Discord: error de descarga - ' + e.message, 'err')
      })
  },

  _add: function (item) {
    if (!item) return
    var ns = item.network_specific || {}
    var key = item._type + ':' + (ns.guild_id ? ns.guild_id + ':' : '') + (item.role ? item.role + ':' : '') + (item.id || item.name || '')
    if (this._seen[key]) return
    this._seen[key] = true
    this.collected.push(item)
    NarsilPanel && NarsilPanel.refresh && NarsilPanel.refresh()
  },

  _extractMemberCandidates: function (body) {
    var out = []
    function pushCandidate(value) {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.forEach(pushCandidate)
        return
      }
      if (value.member) {
        if (value.user && !value.member.user) value.member.user = value.user
        pushCandidate(value.member)
        return
      }
      if (value.user && value.user.id) {
        out.push(value)
        return
      }
      if (value.id && (value.username || value.global_name || value.display_name)) out.push({ user: value })
    }
    if (Array.isArray(body)) body.forEach(pushCandidate)
    else if (body && Array.isArray(body.members)) body.members.forEach(pushCandidate)
    else if (body && Array.isArray(body.results)) body.results.forEach(pushCandidate)
    else pushCandidate(body)
    return out
  },

  _currentGuildId: function () {
    var m = /^\/channels\/(\d+)/.exec(location.pathname || '')
    return m ? m[1] : null
  },

  _currentChannelId: function () {
    var m = /^\/channels\/\d+\/(\d+)/.exec(location.pathname || '')
    return m ? m[1] : null
  },

  _userAvatarUrl: function (u) {
    if (!u || !u.id || !u.avatar) return null
    var ext = String(u.avatar).indexOf('a_') === 0 ? 'gif' : 'png'
    return 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.' + ext
  },

  _memberAvatarUrl: function (guildId, member, cached) {
    if (!member || !member.avatar || !guildId || !(member.user && member.user.id || cached && cached.id)) return null
    var id = (member.user && member.user.id) || cached.id
    var ext = String(member.avatar).indexOf('a_') === 0 ? 'gif' : 'png'
    return 'https://cdn.discordapp.com/guilds/' + guildId + '/users/' + id + '/avatars/' + member.avatar + '.' + ext
  },

  _userBannerUrl: function (u) {
    if (!u || !u.id || !u.banner) return null
    var ext = String(u.banner).indexOf('a_') === 0 ? 'gif' : 'png'
    return 'https://cdn.discordapp.com/banners/' + u.id + '/' + u.banner + '.' + ext
  },

  _guildIconUrl: function (g) {
    if (!g || !g.id || !g.icon) return null
    var ext = String(g.icon).indexOf('a_') === 0 ? 'gif' : 'png'
    return 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + '.' + ext
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

  _firstNumber: function () {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i]
      if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) return Number(v)
    }
    return null
  },

  _text: function (value) {
    if (value === undefined || value === null) return ''
    return this._clean(String(value))
  },

  _clean: function (value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  },

  _addLine: function (lines, label, value) {
    if (value === undefined || value === null || value === '') return
    lines.push(label + ': ' + value)
  },
}
