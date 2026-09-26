/**
 * Contexto de la app: idioma y traducción.
 *
 * En la plataforma este contexto cargaba además tema, sonido y ajustes de pantalla desde el
 * nodo. Aquí no hay nodo del que cargarlos ni sesión que respetar: queda el idioma, que es lo
 * único que `ProfilesPage` consume (`t`). Se mantiene el mismo nombre de hook para que la
 * página siga siendo copia literal de la que ya funciona.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { makeT, normalizeLanguage } from './i18n'
import type { Language } from './i18n'

const LS_LANG = 'narsil:lang'

export interface AppCtxValue {
  language: Language
  setLanguage: (l: Language) => void
  t: (key: string) => string
}

const AppCtx = createContext<AppCtxValue | null>(null)

export const AppProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return normalizeLanguage(localStorage.getItem(LS_LANG) ?? navigator.language)
    } catch {
      return 'es'
    }
  })

  useEffect(() => {
    try { localStorage.setItem(LS_LANG, language) } catch { /* modo privado */ }
  }, [language])

  const t = useCallback(makeT(language), [language])
  const value = useMemo<AppCtxValue>(() => ({ language, setLanguage, t }), [language, t])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useAppCtx(): AppCtxValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useAppCtx fuera de AppProvider')
  return ctx
}
