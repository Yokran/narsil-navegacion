// NARSIL 2026 — Firefox profile defaults
// Applied once on first launch; Firefox merges these into prefs.js.
// To reset a value just delete the line — Firefox will use its own default.

// ── Habilitar userChrome.css / userContent.css ────────────────────────────
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// ── Tema visual ───────────────────────────────────────────────────────────
user_pref("extensions.activeThemeID",   "firefox-compact-dark@mozilla.org");
user_pref("browser.compactmode.show",   true);
user_pref("browser.uidensity",          1);     // 0=normal 1=compact
user_pref("browser.tabs.inTitlebar",    1);     // sin barra de título separada

// ── Barra de favoritos ────────────────────────────────────────────────────
user_pref("browser.toolbars.bookmarks.visibility", "never");
user_pref("browser.uiCustomization.state", "{\"placements\":{\"widget-overflow-fixed-list\":[],\"unified-extensions-area\":[],\"nav-bar\":[\"back-button\",\"forward-button\",\"stop-reload-button\",\"customizableui-special-spring1\",\"vertical-spacer\",\"urlbar-container\",\"customizableui-special-spring2\",\"downloads-button\",\"unified-extensions-button\",\"narsil-intel_narsil_local-browser-action\"],\"toolbar-menubar\":[\"menubar-items\"],\"TabsToolbar\":[\"firefox-view-button\",\"tabbrowser-tabs\",\"new-tab-button\",\"alltabs-button\"],\"PersonalToolbar\":[\"personal-bookmarks\"]},\"seen\":[\"narsil-intel_narsil_local-browser-action\"],\"dirtyAreaCache\":[\"nav-bar\",\"unified-extensions-area\"],\"currentVersion\":22,\"newElementCount\":1}");

// ── Dashboard NARSIL como página de inicio y nueva pestaña ───────────────
// La extensión narsil-newtab@narsil.local sobreescribe la nueva pestaña.
// Requiere extensiones sin firmar (herramienta local, no distribuida).
user_pref("xpinstall.signatures.required",  false);
user_pref("extensions.autoDisableScopes",   0);
user_pref("browser.startup.page",           1);      // 1 = mostrar homepage
user_pref("browser.startup.homepage",       "http://127.0.0.1:8420/newtab");
user_pref("browser.newtabpage.enabled",                                  false);
user_pref("browser.newtabpage.activity-stream.showSponsored",            false);
user_pref("browser.newtabpage.activity-stream.showSponsoredTopSites",    false);
user_pref("browser.newtabpage.activity-stream.feeds.topsites",           false);
user_pref("browser.newtabpage.activity-stream.feeds.section.highlights", false);

// ── Sin cuentas Mozilla / Sync ────────────────────────────────────────────
user_pref("identity.fxaccounts.enabled", false);

// ── Telemetría desactivada ────────────────────────────────────────────────
user_pref("toolkit.telemetry.enabled",                    false);
user_pref("toolkit.telemetry.unified",                    false);
user_pref("datareporting.healthreport.uploadEnabled",     false);
user_pref("datareporting.policy.dataSubmissionEnabled",   false);

// ── Extensiones sin recomendaciones de Mozilla ────────────────────────────
user_pref("extensions.getAddons.showPane",          false);
user_pref("extensions.htmlaboutaddons.recommendations.enabled", false);
