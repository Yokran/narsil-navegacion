// NARSIL Intel Collector - popup.js
'use strict'

var NET_MAP = [
  [/tiktok\.com/, 'tiktok'],
  [/instagram\.com/, 'instagram'],
  [/facebook\.com/, 'facebook'],
  [/(?:twitter|x)\.com/, 'twitter'],
  [/linkedin\.com/, 'linkedin'],
  [/youtube\.com/, 'youtube'],
  [/web\.whatsapp\.com/, 'whatsapp'],
  [/web\.telegram\.org/, 'telegram'],
  [/(?:app\.element\.io|matrix\.org)/, 'matrix'],
  [/discord\.com/, 'discord'],
]

var NET_LABELS = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter / X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  matrix: 'Matrix / Element',
  discord: 'Discord',
}

var FIREFOX_DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'

var UA_PRESETS = [
  {
    id: 'default',
    label: 'Por defecto',
    value: FIREFOX_DESKTOP_UA,
  },
  {
    id: 'chrome_win',
    label: 'Chrome Desktop',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    id: 'opera_win',
    label: 'Opera Desktop',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0',
  },
  {
    id: 'safari_mac',
    label: 'Safari Desktop',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  },
  {
    id: 'android_chrome',
    label: 'Chrome Movil',
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  },
  {
    id: 'android_firefox',
    label: 'Firefox Movil',
    value: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  },
  {
    id: 'android_opera',
    label: 'Opera Movil',
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 OPR/80.0.0.0',
  },
  {
    id: 'iphone_safari',
    label: 'Safari Movil',
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'custom',
    label: 'Personalizado',
    value: '',
  },
]

var currentUaState = {
  enabled: false,
  value: FIREFOX_DESKTOP_UA,
  label: 'Por defecto',
}

browser.runtime.sendMessage({ type: 'MAIN_MENU_OPEN' }).catch(function () {})
window.addEventListener('unload', function () {
  browser.runtime.sendMessage({ type: 'MAIN_MENU_CLOSED' }).catch(function () {})
})

browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === 'CLOSE_MAIN_MENU') {
    window.close()
  }
})

document.addEventListener('keydown', function (event) {
  var key = String(event.key || '').toLowerCase()
  if (event.ctrlKey && event.shiftKey && key === 'y') {
    event.preventDefault()
    window.close()
  }
})

function setStatus(msg) {
  var el = document.getElementById('status')
  if (el) el.textContent = msg || ''
}

function detectNetwork(url) {
  for (var i = 0; i < NET_MAP.length; i++) {
    if (NET_MAP[i][0].test(url || '')) return NET_MAP[i][1]
  }
  return null
}

function getActiveTab() {
  return browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) { return tabs[0] })
}

function fillPresets() {
  var select = document.getElementById('ua-preset')
  var valueEl = document.getElementById('ua-value')
  if (!select.options.length) {
    UA_PRESETS.forEach(function (preset) {
      var option = document.createElement('option')
      option.value = preset.id
      option.textContent = preset.label
      select.appendChild(option)
    })
  }
  select.addEventListener('change', function () {
    var preset = UA_PRESETS.find(function (p) { return p.id === select.value })
    if (!preset) return
    if (preset.id !== 'custom') valueEl.value = preset.value
    updateUserAgentActionState()
  })
  valueEl.addEventListener('input', function () {
    var value = cleanUserAgentValue(valueEl.value)
    var matchingPreset = UA_PRESETS.find(function (p) { return p.id !== 'custom' && p.value === value })
    select.value = matchingPreset ? matchingPreset.id : 'custom'
    updateUserAgentActionState()
  })
}

function presetLabelFor(value, presetId) {
  if (presetId === 'default') return 'Por defecto'
  var preset = UA_PRESETS.find(function (p) { return p.value && p.value === value })
  return preset ? preset.label : 'Personalizado'
}

function cleanUserAgentValue(value) {
  return String(value || '').replace(/[\r\n]/g, ' ').trim()
}

function normalizeUiUserAgentState() {
  var presetId = document.getElementById('ua-preset').value
  var value = cleanUserAgentValue(document.getElementById('ua-value').value)
  if (presetId === 'default') {
    return { enabled: false, value: FIREFOX_DESKTOP_UA, label: 'Por defecto', presetId: presetId }
  }
  return {
    enabled: !!value,
    value: value,
    label: presetLabelFor(value, presetId),
    presetId: presetId,
  }
}

function uaStateSignature(state) {
  if (!state || !state.enabled) return 'default:' + FIREFOX_DESKTOP_UA
  return 'override:' + cleanUserAgentValue(state.value)
}

function updateUserAgentActionState() {
  var activateBtn = document.getElementById('btn-ua-save')
  var deactivateBtn = document.getElementById('btn-ua-clear')
  if (!activateBtn || !deactivateBtn) return
  var candidate = normalizeUiUserAgentState()
  var pending = uaStateSignature(candidate) !== uaStateSignature(currentUaState)
  activateBtn.disabled = !pending
  activateBtn.classList.toggle('primary', pending)
  activateBtn.classList.toggle('pending', pending)
  deactivateBtn.disabled = !currentUaState.enabled
}

function loadUserAgentState() {
  browser.runtime.sendMessage({ type: 'GET_UA_STATE' }).then(function (res) {
    var state = res && res.state || {}
    var value = state.value || FIREFOX_DESKTOP_UA
    currentUaState = {
      enabled: !!state.enabled,
      value: value,
      label: state.label || (state.enabled ? 'Personalizado' : 'Por defecto'),
    }
    document.getElementById('ua-value').value = value
    var preset = UA_PRESETS.find(function (p) { return p.value === value && p.id !== 'default' })
    document.getElementById('ua-preset').value = state.enabled && preset ? preset.id : (state.enabled && value !== FIREFOX_DESKTOP_UA ? 'custom' : 'default')
    updateUserAgentActionState()
  }).catch(function (e) {
    setStatus('No se pudo leer User-Agent: ' + e.message)
  })
}

function saveUserAgentState(enabled, value, label) {
  browser.runtime.sendMessage({
    type: 'SET_UA_STATE',
    state: {
      enabled: enabled,
      value: value,
      label: label,
    },
  }).then(function (res) {
    if (!res || res.ok === false) {
      setStatus('Error User-Agent: ' + (res && res.error || 'desconocido'))
      return
    }
    currentUaState = {
      enabled: !!res.state.enabled,
      value: res.state.value || FIREFOX_DESKTOP_UA,
      label: res.state.label || (res.state.enabled ? 'Personalizado' : 'Por defecto'),
    }
    updateUserAgentActionState()
    if (res.state && res.state.enabled) {
      setStatus('User-Agent aplicado. Recarga las paginas abiertas para que funcione.')
    } else if (res.state && res.state.label === 'Por defecto') {
      setStatus('Perfil por defecto aplicado. Recarga las paginas abiertas.')
    } else {
      setStatus('User-Agent personalizado desactivado. Recarga las paginas abiertas.')
    }
  }).catch(function (e) {
    setStatus('Error User-Agent: ' + e.message)
  })
}

function loadRecorderState() {
  browser.runtime.sendMessage({ type: 'GET_TAB_RECORDER_STATE' }).then(function (res) {
    var state = res && res.state || {}
    updateRecorderUi(state)
  }).catch(function () {})
}

function updateRecorderUi(state) {
  var el = document.getElementById('recorder-state')
  var btn = document.getElementById('btn-rec-toggle')
  if (!el || !btn) return
  state = state || {}
  if (state.recording || state.stopping) {
    btn.textContent = state.stopping ? 'Finalizando grabacion...' : 'Finalizar grabacion'
    btn.disabled = !!state.stopping
    btn.classList.add('recording')
    el.textContent = 'Grabacion activa. Frames enviados: ' + (state.uploadedFrames || state.frames || 0) + '.'
    if (state.lastError) el.textContent += ' Ultimo error: ' + state.lastError
    return
  }
  btn.textContent = 'Iniciar grabacion de pestana'
  btn.disabled = false
  btn.classList.remove('recording')
  if (state.lastSummary) {
    el.textContent = 'Ultima sesion: ' + (state.lastSummary.frames || 0) + ' frame(s)'
      + (state.lastSummary.filename ? ', video ' + state.lastSummary.filename + '.' : '.')
  } else {
    el.textContent = 'Graba visualmente la pestana activa del navegador enfocado. Al cambiar de pestana, la sesion sigue la pestana activa.'
  }
}

fillPresets()
loadUserAgentState()
loadRecorderState()
setInterval(loadRecorderState, 1000)

getActiveTab().then(function (tab) {
  var network = detectNetwork(tab && tab.url)
  document.getElementById('net-name').textContent = network ? NET_LABELS[network] : 'No compatible'
})

Array.prototype.forEach.call(document.querySelectorAll('.module-link'), function (button) {
  button.addEventListener('click', function () {
    var url = button.getAttribute('data-url')
    if (!url) return
    getActiveTab().then(function (tab) {
      if (tab && tab.id) {
        return browser.tabs.update(tab.id, { url: url, active: true })
      }
      return browser.tabs.create({ url: url, active: true })
    }).then(function () {
      window.close()
    }).catch(function (e) {
      setStatus('No se pudo abrir el servicio: ' + e.message)
    })
  })
})

document.getElementById('btn-ua-save').addEventListener('click', function () {
  var candidate = normalizeUiUserAgentState()
  if (candidate.enabled && !candidate.value) {
    setStatus('Introduce un User-Agent o elige un perfil.')
    return
  }
  if (uaStateSignature(candidate) === uaStateSignature(currentUaState)) {
    setStatus('No hay cambios de User-Agent pendientes.')
    updateUserAgentActionState()
    return
  }
  document.getElementById('ua-value').value = candidate.value
  saveUserAgentState(candidate.enabled, candidate.value, candidate.label)
})

document.getElementById('btn-ua-clear').addEventListener('click', function () {
  document.getElementById('ua-preset').value = 'default'
  document.getElementById('ua-value').value = FIREFOX_DESKTOP_UA
  saveUserAgentState(false, FIREFOX_DESKTOP_UA, 'Por defecto')
})

document.getElementById('btn-rec-toggle').addEventListener('click', function () {
  browser.runtime.sendMessage({ type: 'GET_TAB_RECORDER_STATE' }).then(function (stateRes) {
    var state = stateRes && stateRes.state || {}
    if (state.recording || state.stopping) {
      updateRecorderUi(Object.assign({}, state, { stopping: true }))
      return browser.runtime.sendMessage({ type: 'STOP_TAB_RECORDING' }).then(function (res) {
        if (!res || res.ok === false) {
          setStatus('No se pudo finalizar la grabacion: ' + (res && res.error || 'desconocido'))
          loadRecorderState()
          return
        }
        updateRecorderUi({ lastSummary: res.state })
        if (res.state && res.state.lastError) {
          setStatus('Grabacion finalizada con error: ' + res.state.lastError)
        } else {
          setStatus('Grabacion finalizada. Se ha generado el video de evidencia procesado.')
        }
      })
    }

    return browser.runtime.sendMessage({
      type: 'START_TAB_RECORDING',
      options: { fps: 3 },
    }).then(function (res) {
      if (!res || res.ok === false) {
        setStatus('No se pudo iniciar la grabacion: ' + (res && res.error || 'desconocido'))
        loadRecorderState()
        return
      }
      updateRecorderUi(res.state)
      setStatus('Grabacion iniciada. Vuelve a abrir este menu para finalizarla cuando termines.')
      setTimeout(function () { window.close() }, 250)
    })
  }).catch(function (e) {
    setStatus('Error del grabador: ' + e.message)
  })
})
