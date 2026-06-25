'use strict'

// On-open behavior (Quick Fill vs Open Popup) is controlled via the popup UI
// and stored in chrome.storage.local as pref_onOpen. No background logic needed.

// Clean up any context menus left over from previous versions.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll()
})
