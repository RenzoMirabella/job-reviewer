// Crea la opción del menú contextual y le pasa al panel lateral el texto seleccionado,
// el título de la pestaña (de ahí sale puesto y empresa) y el link del aviso.
importScripts("profile-default.js");

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "evaluar-aviso", title: "Evaluar este aviso", contexts: ["selection"] });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Versión 0.2: el perfil arranca vacío. Si venía de la 0.1, se conserva solo la configuración de IA.
  const { profile, settings } = await chrome.storage.local.get(["profile", "settings"]);
  if (!profile || profile.schema !== 2) {
    const s = settings || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (profile && profile.ai && !settings) s.ai = { ...s.ai, ...profile.ai };
    await chrome.storage.local.set({ profile: JSON.parse(JSON.stringify(EMPTY_PROFILE)), settings: s });
  }
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "evaluar-aviso" || !tab) return;

  // Abrir el panel primero: Chrome solo lo permite como respuesta directa al clic.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});

  // info.selectionText pierde los saltos de línea, y el motor los usa para encontrar
  // las secciones del aviso. Por eso leemos la selección de la pestaña, una sola vez,
  // con el permiso temporal que da el propio clic (activeTab).
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: () => String(window.getSelection()) })
    .then((res) => (res && res[0] && res[0].result) || info.selectionText || "")
    .catch(() => info.selectionText || "")
    .then((text) => chrome.storage.session.set({ pending: { text, url: tab.url || "", title: tab.title || "", at: Date.now() } }));
});
