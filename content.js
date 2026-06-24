'use strict'

// Detection and autofill now run via chrome.scripting.executeScript({ world: 'MAIN' })
// in popup.js, which has direct React access and bypasses CSP.
// This content script is kept as a stub for any future messaging needs.

chrome.runtime.onMessage.addListener((_message, _sender, _sendResponse) => {
  return false
})
