// NARSIL 2026 — cadenas de la interfaz.
//
// Sólo las que usa esta app. Venía de la plataforma con 233 claves (proveedores de modelos,
// sonido, activación de licencia, ventanas, capas): 188 no las pedía nadie y lo que hacían era
// ocultar las 45 que sí. Si falta una clave, `makeT` devuelve la clave misma y se ve en pantalla.
//
// Los nombres de capa (Analyzer, Harvester, Tracer, N.A.R.S.I.L.) son marca: no se traducen.

export type Language = 'es' | 'en' | 'fr' | 'de' | 'it' | 'pt'

export const LANGUAGE_OPTIONS: { id: Language; native: string; label: string }[] = [
  { id: 'es', native: 'Español',    label: 'Spanish' },
  { id: 'en', native: 'English',    label: 'English' },
  { id: 'fr', native: 'Français',   label: 'French' },
  { id: 'de', native: 'Deutsch',    label: 'German' },
  { id: 'it', native: 'Italiano',   label: 'Italian' },
  { id: 'pt', native: 'Português',  label: 'Portuguese' },
]

const SUPPORTED = new Set<Language>(LANGUAGE_OPTIONS.map(l => l.id))

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && SUPPORTED.has(value as Language)
}

export function normalizeLanguage(value: unknown): Language {
  return isLanguage(value) ? value : 'es'
}

const S: Record<string, Record<Language, string>> = {
  // Shell
  'win.close':                  { es: 'Cerrar', en: 'Close', fr: 'Fermer', de: 'Schließen', it: 'Chiudi', pt: 'Fechar' },

  // Shared chrome
  'common.active':              { es: 'ACTIVO', en: 'ACTIVE', fr: 'ACTIF', de: 'AKTIV', it: 'ATTIVO', pt: 'ATIVO' },
  'common.inactive':            { es: 'INACTIVO', en: 'INACTIVE', fr: 'INACTIF', de: 'INAKTIV', it: 'INATTIVO', pt: 'INATIVO' },

  // Profiles / navigation page
  'profiles.title':             { es: 'Navegación', en: 'Navigation', fr: 'Navigation', de: 'Navigation', it: 'Navigazione', pt: 'Navegação' },
  'profiles.subtitle':          { es: 'Gestión de identidades digitales - doble clic para abrir', en: 'Digital identity management - double-click to open', fr: 'Gestion des identités numériques - double-clic pour ouvrir', de: 'Verwaltung digitaler Identitäten - Doppelklick zum Öffnen', it: 'Gestione delle identità digitali - doppio clic per aprire', pt: 'Gestão de identidades digitais - duplo clique para abrir' },
  'profiles.checking_browser':  { es: 'Comprobando navegador...', en: 'Checking browser...', fr: 'Vérification du navigateur...', de: 'Browser wird geprüft...', it: 'Verifica browser...', pt: 'A verificar navegador...' },
  'profiles.new':               { es: '+ Nuevo perfil', en: '+ New profile', fr: '+ Nouveau profil', de: '+ Neues Profil', it: '+ Nuovo profilo', pt: '+ Novo perfil' },
  'profiles.creating':          { es: 'Creando perfil', en: 'Creating profile', fr: 'Création du profil', de: 'Profil wird erstellt', it: 'Creazione profilo', pt: 'A criar perfil' },
  'profiles.identity_name':     { es: 'Nombre de la identidad digital.', en: 'Digital identity name.', fr: 'Nom de l’identité numérique.', de: 'Name der digitalen Identität.', it: 'Nome dell’identità digitale.', pt: 'Nome da identidade digital.' },
  'profiles.profile_placeholder': { es: 'Nombre del perfil...', en: 'Profile name...', fr: 'Nom du profil...', de: 'Profilname...', it: 'Nome profilo...', pt: 'Nome do perfil...' },
  'profiles.base_template':     { es: 'PLANTILLA BASE', en: 'BASE TEMPLATE', fr: 'MODÈLE DE BASE', de: 'BASISVORLAGE', it: 'MODELLO BASE', pt: 'MODELO BASE' },
  'profiles.no_template':       { es: 'Sin plantilla (perfil vacío)', en: 'No template (empty profile)', fr: 'Sans modèle (profil vide)', de: 'Keine Vorlage (leeres Profil)', it: 'Nessun modello (profilo vuoto)', pt: 'Sem modelo (perfil vazio)' },
  'profiles.create':            { es: 'Crear', en: 'Create', fr: 'Créer', de: 'Erstellen', it: 'Crea', pt: 'Criar' },
  'profiles.avatar':            { es: 'Avatar', en: 'Avatar', fr: 'Avatar', de: 'Avatar', it: 'Avatar', pt: 'Avatar' },
  'profiles.open':              { es: 'Abrir', en: 'Open', fr: 'Ouvrir', de: 'Öffnen', it: 'Apri', pt: 'Abrir' },
  'profiles.delete':            { es: 'Eliminar', en: 'Delete', fr: 'Supprimer', de: 'Löschen', it: 'Elimina', pt: 'Eliminar' },
  'profiles.refresh':           { es: 'Refrescar', en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', it: 'Aggiorna', pt: 'Atualizar' },
  'profiles.save_template':     { es: 'Guardar como plantilla', en: 'Save as template', fr: 'Enregistrer comme modèle', de: 'Als Vorlage speichern', it: 'Salva come modello', pt: 'Guardar como modelo' },
  'profiles.templates':         { es: 'Plantillas', en: 'Templates', fr: 'Modèles', de: 'Vorlagen', it: 'Modelli', pt: 'Modelos' },
  'profiles.no_templates':      { es: 'No hay plantillas disponibles.', en: 'No templates available.', fr: 'Aucun modèle disponible.', de: 'Keine Vorlagen verfügbar.', it: 'Nessun modello disponibile.', pt: 'Não há modelos disponíveis.' },
  'profiles.loading':           { es: 'Cargando perfiles...', en: 'Loading profiles...', fr: 'Chargement des profils...', de: 'Profile werden geladen...', it: 'Caricamento profili...', pt: 'A carregar perfis...' },
  'profiles.empty':             { es: 'Sin perfiles. Crea uno para comenzar.', en: 'No profiles. Create one to start.', fr: 'Aucun profil. Créez-en un pour commencer.', de: 'Keine Profile. Erstellen Sie eines, um zu beginnen.', it: 'Nessun profilo. Creane uno per iniziare.', pt: 'Sem perfis. Crie um para começar.' },
  'profiles.select':            { es: 'SELECCIONA UN PERFIL', en: 'SELECT A PROFILE', fr: 'SÉLECTIONNEZ UN PROFIL', de: 'PROFIL AUSWÄHLEN', it: 'SELEZIONA UN PROFILO', pt: 'SELECIONE UM PERFIL' },
  'profiles.close_before_edit': { es: 'Cierra el navegador del perfil antes de editar', en: 'Close this profile browser before editing', fr: 'Fermez le navigateur du profil avant de modifier', de: 'Schließen Sie den Profilbrowser vor dem Bearbeiten', it: 'Chiudi il browser del profilo prima di modificare', pt: 'Feche o navegador do perfil antes de editar' },
  'profiles.edit':              { es: 'Editar perfil', en: 'Edit profile', fr: 'Modifier le profil', de: 'Profil bearbeiten', it: 'Modifica profilo', pt: 'Editar perfil' },
  'profiles.edit_short':        { es: 'EDITAR', en: 'EDIT', fr: 'MODIFIER', de: 'BEARBEITEN', it: 'MODIFICA', pt: 'EDITAR' },
  'profiles.cancel':            { es: 'CANCELAR', en: 'CANCEL', fr: 'ANNULER', de: 'ABBRECHEN', it: 'ANNULLA', pt: 'CANCELAR' },
  'profiles.save':              { es: 'GUARDAR', en: 'SAVE', fr: 'ENREGISTRER', de: 'SPEICHERN', it: 'SALVA', pt: 'GUARDAR' },
  'profiles.category':          { es: 'CATEGORÍA', en: 'CATEGORY', fr: 'CATÉGORIE', de: 'KATEGORIE', it: 'CATEGORIA', pt: 'CATEGORIA' },
  'profiles.created':           { es: 'CREADO', en: 'CREATED', fr: 'CRÉÉ', de: 'ERSTELLT', it: 'CREATO', pt: 'CRIADO' },
  'profiles.state':             { es: 'ESTADO', en: 'STATUS', fr: 'ÉTAT', de: 'STATUS', it: 'STATO', pt: 'ESTADO' },
  'profiles.description':       { es: 'DESCRIPCIÓN', en: 'DESCRIPTION', fr: 'DESCRIPTION', de: 'BESCHREIBUNG', it: 'DESCRIZIONE', pt: 'DESCRIÇÃO' },
  'profiles.notes':             { es: 'NOTAS OPERATIVAS', en: 'OPERATIONAL NOTES', fr: 'NOTES OPÉRATIONNELLES', de: 'OPERATIVE NOTIZEN', it: 'NOTE OPERATIVE', pt: 'NOTAS OPERACIONAIS' },
  'profiles.credentials':       { es: 'CREDENCIALES', en: 'CREDENTIALS', fr: 'IDENTIFIANTS', de: 'ZUGANGSDATEN', it: 'CREDENZIALI', pt: 'CREDENCIAIS' },
  'profiles.hide':              { es: 'OCULTAR', en: 'HIDE', fr: 'MASQUER', de: 'AUSBLENDEN', it: 'NASCONDI', pt: 'OCULTAR' },
  'profiles.show':              { es: 'MOSTRAR', en: 'SHOW', fr: 'AFFICHER', de: 'ANZEIGEN', it: 'MOSTRA', pt: 'MOSTRAR' },
  'profiles.protected':         { es: 'PROTEGIDO', en: 'PROTECTED', fr: 'PROTÉGÉ', de: 'GESCHÜTZT', it: 'PROTETTO', pt: 'PROTEGIDO' },
  'profiles.active_services':   { es: 'SERVICIOS ACTIVOS', en: 'ACTIVE SERVICES', fr: 'SERVICES ACTIFS', de: 'AKTIVE DIENSTE', it: 'SERVIZI ATTIVI', pt: 'SERVIÇOS ATIVOS' },
  'profiles.services_hint':     { es: 'Marca los servicios en los que este perfil tendrá cuenta.', en: 'Mark the services where this profile will have an account.', fr: 'Cochez les services où ce profil aura un compte.', de: 'Markieren Sie die Dienste, bei denen dieses Profil ein Konto haben wird.', it: 'Seleziona i servizi in cui questo profilo avrà un account.', pt: 'Marque os serviços onde este perfil terá conta.' },
  'profiles.selected_count':    { es: 'seleccionados', en: 'selected', fr: 'sélectionnés', de: 'ausgewählt', it: 'selezionati', pt: 'selecionados' },
  'profiles.apply':             { es: 'Aplicar', en: 'Apply', fr: 'Appliquer', de: 'Anwenden', it: 'Applica', pt: 'Aplicar' },
  'profiles.manage':            { es: 'Gestionar', en: 'Manage', fr: 'Gérer', de: 'Verwalten', it: 'Gestisci', pt: 'Gerir' },
  'profiles.unused':            { es: '- perfil no utilizado aún', en: '- profile not used yet', fr: '- profil pas encore utilisé', de: '- Profil noch nicht verwendet', it: '- profilo non ancora usato', pt: '- perfil ainda não utilizado' },
  'profiles.last_ip':           { es: 'ÚLTIMA IP DETECTADA', en: 'LAST DETECTED IP', fr: 'DERNIÈRE IP DÉTECTÉE', de: 'LETZTE ERKANNTE IP', it: 'ULTIMO IP RILEVATO', pt: 'ÚLTIMO IP DETETADO' },
  'profiles.ready':             { es: 'Listo', en: 'Ready', fr: 'Prêt', de: 'Bereit', it: 'Pronto', pt: 'Pronto' },

}

export function makeT(lang: Language): (key: string) => string {
  const safeLang = normalizeLanguage(lang)
  return (key: string): string => S[key]?.[safeLang] ?? S[key]?.es ?? key
}
