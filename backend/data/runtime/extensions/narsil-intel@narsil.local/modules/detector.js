// NARSIL Intel Collector — modules/detector.js
// Detects which social network the current tab belongs to.
'use strict'

var NarsilDetector = {
  detect: function (href) {
    var url = href || location.href
    if (/tiktok\.com/i.test(url))                      return 'tiktok'
    if (/instagram\.com/i.test(url))                   return 'instagram'
    if (/facebook\.com/i.test(url))                    return 'facebook'
    if (/(?:twitter|x)\.com/i.test(url))               return 'twitter'
    if (/linkedin\.com/i.test(url))                    return 'linkedin'
    if (/youtube\.com/i.test(url))                     return 'youtube'
    if (/web\.whatsapp\.com/i.test(url))               return 'whatsapp'
    if (/web\.telegram\.org/i.test(url))               return 'telegram'
    if (/(?:app\.element\.io|matrix\.org)/i.test(url)) return 'matrix'
    if (/discord\.com/i.test(url))                     return 'discord'
    return null
  },

  current: function () {
    return NarsilDetector.detect(location.href)
  },

  label: function (network) {
    var labels = {
      tiktok:    'TikTok',
      instagram: 'Instagram',
      facebook:  'Facebook',
      twitter:   'Twitter / X',
      linkedin:  'LinkedIn',
      youtube:   'YouTube',
      whatsapp:  'WhatsApp',
      telegram:  'Telegram',
      matrix:    'Matrix / Element',
      discord:   'Discord',
    }
    return labels[network] || network || '—'
  },
}

// Global registry for all network modules.
var NarsilModules = {}
