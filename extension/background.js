// Opens the side panel when the toolbar icon is clicked, for every tab.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[Ascent Assistant] setPanelBehavior failed:", err));
