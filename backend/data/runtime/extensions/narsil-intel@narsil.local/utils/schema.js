// NARSIL Intel Collector — utils/schema.js
// Homogeneous data schema builders. Every record has common fields + network_specific.
'use strict'

var NarsilSchema = {
  profile: function (network, d) {
    return {
      _type:        'profile',
      _network:     network,
      _ts:          Date.now(),
      id:           d.id           || null,
      username:     d.username     || null,
      display_name: d.display_name || null,
      bio:          d.bio          || null,
      avatar_url:   d.avatar_url   || null,
      followers:    d.followers    != null ? Number(d.followers) : null,
      following:    d.following    != null ? Number(d.following) : null,
      posts:        d.posts        != null ? Number(d.posts)     : null,
      verified:     d.verified     != null ? !!d.verified        : null,
      url:          d.url          || null,
      location:     d.location     || null,
      network_specific: d.network_specific || {},
    }
  },

  post: function (network, d) {
    return {
      _type:           'post',
      _network:        network,
      _ts:             Date.now(),
      id:              d.id              || null,
      author_id:       d.author_id       || null,
      author_username: d.author_username || null,
      content:         d.content         || null,
      media_urls:      Array.isArray(d.media_urls) ? d.media_urls : [],
      likes:           d.likes    != null ? Number(d.likes)    : null,
      comments:        d.comments != null ? Number(d.comments) : null,
      shares:          d.shares   != null ? Number(d.shares)   : null,
      views:           d.views    != null ? Number(d.views)    : null,
      published_at:    d.published_at || null,
      url:             d.url          || null,
      network_specific: d.network_specific || {},
    }
  },

  contact: function (network, d) {
    return {
      _type:        'contact',
      _network:     network,
      _ts:          Date.now(),
      id:           d.id           || null,
      username:     d.username     || null,
      display_name: d.display_name || null,
      phone:        d.phone        || null,
      email:        d.email        || null,
      role:         d.role         || null,
      avatar_url:   d.avatar_url   || null,
      network_specific: d.network_specific || {},
    }
  },

  group: function (network, d) {
    return {
      _type:        'group',
      _network:     network,
      _ts:          Date.now(),
      id:           d.id           || null,
      name:         d.name         || null,
      description:  d.description  || null,
      member_count: d.member_count != null ? Number(d.member_count) : null,
      url:          d.url          || null,
      members:      Array.isArray(d.members) ? d.members : [],
      network_specific: d.network_specific || {},
    }
  },
}
