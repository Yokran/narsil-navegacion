// NARSIL 2026 — API client

const BASE = '/api'

export interface ProfileInfo {
  name: string
  has_avatar: boolean
  avatar_url: string | null
  running: boolean
  created_at: string
}

export interface ProfileMeta {
  category:         string    // OSINT | SOCMINT | V.HUMINT | OTROS
  description:      string
  notes:            string
  credentials:      string
  services:         string[]  // IDs de servicios activos
  // Computed / read-only — present in GET response, ignored in POST
  last_ip?:         string
  last_ip_isp?:     string
  last_ip_country?: string
  last_ip_vpn?:     boolean
  user_agent?:      string
}

export interface CloneProgressEvent {
  type: 'start' | 'progress' | 'done' | 'error'
  name?: string
  current?: number
  total?: number
  pct?: number
  message?: string
  ok?: boolean
}

export interface TemplateInfo {
  name: string
  display: string
  protected: boolean
}

export interface BrowserStatus {
  installed: boolean
  exe: string
  /** ESR: un Firefox release existe y arranca, pero deja la extensión Collector fuera sin avisar. */
  apto: boolean
  origen: 'app' | 'sistema' | null
  detalle: string
}

export interface InstallEvent {
  type: 'progress' | 'done'
  pct?: number
  message?: string
  ok?: boolean
}

// ── Profiles ──────────────────────────────────────────────────────────────

export async function fetchProfiles(): Promise<ProfileInfo[]> {
  const r = await fetch(`${BASE}/profiles`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export function createProfile(
  name: string,
  template: string,
  onEvent: (e: CloneProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template }),
      signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`
          try {
            const json = await res.json()
            if (json.detail) errMsg = json.detail
          } catch {
            const text = await res.text()
            if (text) errMsg = text.slice(0, 200)
          }
          reject(new Error(errMsg))
          return
        }
        if (!res.body) {
          reject(new Error('Response body is empty'))
          return
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const chunk of lines) {
            if (!chunk.startsWith('data: ')) continue
            try {
              const evt = JSON.parse(chunk.slice(6)) as CloneProgressEvent
              onEvent(evt)
            } catch { /* skip malformed */ }
          }
        }
        resolve()
      })
      .catch(reject)
  })
}

export async function deleteProfile(name: string): Promise<void> {
  const r = await fetch(`${BASE}/profiles/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg)
  }
}

export async function renameProfile(name: string, newName: string): Promise<ProfileInfo> {
  const r = await fetch(`${BASE}/profiles/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg)
  }
  const json = await r.json()
  return json.profile
}

export async function openProfile(name: string): Promise<void> {
  const r = await fetch(`${BASE}/profiles/${encodeURIComponent(name)}/open`, {
    method: 'POST',
  })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg)
  }
}

export async function uploadAvatar(name: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(`${BASE}/profiles/${encodeURIComponent(name)}/avatar`, {
    method: 'POST',
    body: form,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const json = await r.json()
  return json.avatar_url
}

export async function fetchTemplates(): Promise<TemplateInfo[]> {
  const r = await fetch(`${BASE}/profiles/templates`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function fetchProfileMeta(name: string): Promise<ProfileMeta> {
  const r = await fetch(`${BASE}/profiles/${encodeURIComponent(name)}/meta`)
  if (!r.ok) return { category: '', description: '', notes: '', credentials: '', services: [] }
  return r.json()
}

export async function saveProfileMeta(name: string, meta: ProfileMeta): Promise<void> {
  const r = await fetch(`${BASE}/profiles/${encodeURIComponent(name)}/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function saveTemplateFromProfile(
  profileName: string,
  templateName: string,
): Promise<{ ok: boolean; synced: string[] }> {
  const r = await fetch(
    `${BASE}/profiles/templates/save-from/${encodeURIComponent(profileName)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_name: templateName }),
    },
  )
  if (!r.ok) { const msg = await r.text(); throw new Error(msg) }
  return r.json()
}

export async function deleteTemplate(name: string): Promise<void> {
  const r = await fetch(
    `${BASE}/profiles/templates/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
  if (!r.ok) { const msg = await r.text(); throw new Error(msg) }
}

export async function fetchBrowserStatus(): Promise<BrowserStatus> {
  const r = await fetch(`${BASE}/profiles/browser/status`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export function installBrowser(
  onEvent: (e: InstallEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/profiles/browser/install`, { method: 'POST', signal })
      .then(async (res) => {
        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`
          try {
            const json = await res.json()
            if (json.detail) errMsg = json.detail
          } catch {
            const text = await res.text()
            if (text) errMsg = text.slice(0, 200)
          }
          reject(new Error(errMsg))
          return
        }
        if (!res.body) {
          reject(new Error('Response body is empty'))
          return
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const chunk of lines) {
            if (!chunk.startsWith('data: ')) continue
            try { onEvent(JSON.parse(chunk.slice(6)) as InstallEvent) } catch { /* skip */ }
          }
        }
        resolve()
      })
      .catch(reject)
  })
}

// ── S.A.R.A. ────────────────────────────────────────────────────────────
// La app corre suelta en el equipo del operador, pero el resto de la plataforma
// (expedientes, grafo, informes) lo sirve S.A.R.A. Aquí se guarda dónde está, se
// pregunta si contesta y se abre — y lo de «abrir» lo hace el backend con el
// navegador del sistema, no esta interfaz.

export interface NodeSettings {
  url: string
}

export interface NodeProbe {
  configured: boolean
  reachable: boolean
  url?: string
  version?: string
  detail: string
}

export async function fetchNode(): Promise<NodeSettings> {
  const r = await fetch(`${BASE}/node`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function saveNode(url: string): Promise<string> {
  const r = await fetch(`${BASE}/node`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!r.ok) {
    // El backend explica POR QUÉ no vale (esquema, servidor ausente): se propaga tal cual.
    let msg = `HTTP ${r.status}`
    try { const j = await r.json(); if (j.detail) msg = j.detail } catch { /* sin cuerpo */ }
    throw new Error(msg)
  }
  const json = await r.json()
  return json.url
}

export async function probeNode(): Promise<NodeProbe> {
  const r = await fetch(`${BASE}/node/probe`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function openNode(): Promise<void> {
  const r = await fetch(`${BASE}/node/open`, { method: 'POST' })
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try { const j = await r.json(); if (j.detail) msg = j.detail } catch { /* sin cuerpo */ }
    throw new Error(msg)
  }
}

/** Información de acceso completo a la plataforma: la abre el backend en el navegador del
 *  sistema, fuera de la app y de cualquier identidad. */
export async function abrirEnlaceAcceso(): Promise<void> {
  const r = await fetch(`${BASE}/enlace/acceso`, { method: 'POST' })
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try { const j = await r.json(); if (j.detail) msg = j.detail } catch { /* sin cuerpo */ }
    throw new Error(msg)
  }
}


// ── Actualizaciones ────────────────────────────────────────────────────────
// Solo cuando el operador pulsa el botón: la app no consulta GitHub por su cuenta.

export interface InfoActualizacion {
  actual: string
  publicada: string
  disponible: boolean
  aplicable: boolean
  notas: string
  url_release: string
  artefacto: string
  tamano: number
}

export interface EventoActualizacion {
  type: 'progress' | 'done'
  pct?: number
  message: string
  ok?: boolean
  instalada?: boolean
}

export async function comprobarActualizacion(): Promise<InfoActualizacion> {
  const r = await fetch(`${BASE}/actualizaciones`)
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try { const j = await r.json(); if (j.detail) msg = j.detail } catch { /* sin cuerpo */ }
    throw new Error(msg)
  }
  return r.json()
}

/** Descarga, verifica y reinicia. Los eventos llegan por SSE; el último trae `reinicia`. */
export function aplicarActualizacion(onEvent: (e: EventoActualizacion) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/actualizaciones/aplicar`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `HTTP ${res.status}`
          try { const j = await res.json(); if (j.detail) msg = j.detail } catch { /* sin cuerpo */ }
          reject(new Error(msg))
          return
        }
        if (!res.body) { reject(new Error('Respuesta vacía')); return }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const chunk of lines) {
            if (!chunk.startsWith('data: ')) continue
            try { onEvent(JSON.parse(chunk.slice(6)) as EventoActualizacion) } catch { /* trozo roto */ }
          }
        }
        resolve()
      })
      .catch(reject)
  })
}

/** Tras instalar: la app suelta ventanas y puerto y se cierra. El operador la vuelve a abrir. */
export async function cerrarAplicacion(): Promise<void> {
  const r = await fetch(`${BASE}/actualizaciones/cerrar`, { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}
