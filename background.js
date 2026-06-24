'use strict'

// Left-click → default_popup opens inline and auto-runs Quick Fill.
// Right-click → context menu to open the full panel as a detached window (no auto-run).

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-panel',
      title: 'Open Panel (no auto-fill)',
      contexts: ['action']
    })
  })
})

let panelWindowId = null

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'open-panel') return

  // Re-focus existing panel window if still open.
  if (panelWindowId !== null) {
    try { await chrome.windows.update(panelWindowId, { focused: true }); return }
    catch { panelWindowId = null }
  }

  // suppressAutoRun tells the popup to skip Quick Fill on load.
  await chrome.storage.session.set({ suppressAutoRun: true })

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 400,
    height: 560,
    focused: true
  })
  panelWindowId = win.id
  chrome.windows.onRemoved.addListener(function cleanup(id) {
    if (id === panelWindowId) { panelWindowId = null; chrome.windows.onRemoved.removeListener(cleanup) }
  })
})
