// BREAKEX background.js
// Owns all alert data + chrome.alarms scheduling. The popup, options page,
// and content scripts never touch storage directly — everything routes
// through this service worker so timers keep running even if the popup
// is closed.

const STORAGE_KEY = "breakex_alerts";
const ACTIVE_ALERTS_KEY = "breakex_active_alerts"; // Tracks currently showing alerts
const SNOOZE_MINUTES = 5;

const DEFAULT_ALERTS = [
  {
    id: "default-screen-break",
    name: "Screen Break",
    durationMinutes: 60,
    fileUrl: "assets/screen-break.svg",
    fileType: "svg",
    isDefault: true,
    active: true,
    endTime: 0
  },
  {
    id: "default-water-break",
    name: "Water Break",
    durationMinutes: 20,
    fileUrl: "assets/water-break.svg",
    fileType: "svg",
    isDefault: true,
    active: true,
    endTime: 0
  }
];

// Set of alert IDs currently showing to the user (persisted across SW restarts).
// Multiple alerts can be active simultaneously.
let currentActiveAlertIds = new Set();

async function getActiveAlertIds() {
  const data = await chrome.storage.local.get(ACTIVE_ALERTS_KEY);
  return new Set(data[ACTIVE_ALERTS_KEY] || []);
}

async function saveActiveAlertIds(ids) {
  await chrome.storage.local.set({ [ACTIVE_ALERTS_KEY]: Array.from(ids) });
}

// Load persisted active alerts on startup
async function loadPersistedActiveAlerts() {
  currentActiveAlertIds = await getActiveAlertIds();
}

function genId() {
  return "alert-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

async function getAlerts() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveAlerts(alerts) {
  await chrome.storage.local.set({ [STORAGE_KEY]: alerts });
}

async function scheduleAlarm(alert) {
  await chrome.alarms.clear(alert.id);
  if (alert.active) {
    chrome.alarms.create(alert.id, { when: alert.endTime });
  }
}

async function rescheduleAllAlarms(alerts) {
  for (const alert of alerts) {
    await scheduleAlarm(alert);
  }
}

// ---- Setup / migration ----

async function ensureInitialized() {
  let alerts = await getAlerts();
  if (!alerts || alerts.length === 0) {
    const now = Date.now();
    alerts = DEFAULT_ALERTS.map((a) => ({
      ...a,
      endTime: now + a.durationMinutes * 60000
    }));
    await saveAlerts(alerts);
  }
  // Fix up any alerts whose endTime already passed while the browser
  // was closed, so we don't fire a wall of stale alarms on startup.
  const now = Date.now();
  let changed = false;
  alerts = alerts.map((a) => {
    if (a.active && (!a.endTime || a.endTime < now)) {
      changed = true;
      // If it was overdue, fire immediately (endTime = now) so user sees it right away
      return { ...a, endTime: now };
    }
    return a;
  });
  if (changed) await saveAlerts(alerts);
  await rescheduleAllAlarms(alerts);

  // Load persisted active alerts and re-show them on eligible tabs
  await loadPersistedActiveAlerts();
  if (currentActiveAlertIds.size > 0) {
    await reshowActiveAlerts();
  }
}

async function reshowActiveAlerts() {
  const alerts = await getAlerts();
  const stillActive = new Set();
  for (const alertId of currentActiveAlertIds) {
    const alert = alerts.find(a => a.id === alertId);
    if (alert && alert.active) {
      stillActive.add(alertId);
      // Try to show on the best available tab
      const tab = await getBestActiveTab();
      if (tab) {
        await sendToTab(tab.id, {
          type: "BREAKEX_SHOW",
          alert: {
            id: alert.id,
            name: alert.name,
            fileDataUrl: alert.fileDataUrl,
            fileType: alert.fileType
          }
        });
      }
    }
  }
  currentActiveAlertIds = stillActive;
  await saveActiveAlertIds(currentActiveAlertIds);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureInitialized();

  // Request notification permission on install
  if (details.reason === 'install') {
    try {
      await chrome.notifications.getPermissionLevel();
      // Permission already granted or denied
    } catch (e) {
      // Permission not requested yet - the first notification.create will prompt
    }
  }
});
chrome.runtime.onStartup.addListener(() => {
  ensureInitialized();
});

// ---- Tab helpers ----

async function getBestActiveTab() {
  // Prefer the active tab of the last focused normal window.
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab = tabs[0];
  if (tab && tab.url && /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    // Don't filter out new tab pages - we'll handle them specially
    if (!/^(chrome|edge):\/\/newtab/i.test(tab.url)) {
      tab = null;
    }
  }
  if (tab) return tab;

  // Fall back to any active tab in any window with an injectable URL.
  const allActive = await chrome.tabs.query({ active: true });
  return allActive.find((t) => t.url && !/^(chrome|edge|about|chrome-extension):/i.test(t.url)) || null;
}

function isNewTabPage(url) {
  return /^(chrome|edge):\/\/newtab/i.test(url);
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (e) {
    // Content script probably wasn't injected yet (tab loaded before
    // install/update). Inject it manually then retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch (e2) {
      console.warn("BREAKEX: could not display alert in this tab.", e2);
      return false;
    }
  }
}

async function isTabInjectable(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) return false;
    // Allow injection on regular pages, but NOT on browser internal pages
    // New tab pages are handled separately via notifications/popup
    return !/^(chrome|edge|about|chrome-extension):/i.test(tab.url);
  } catch (e) {
    return false;
  }
}

async function tryForwardActiveAlertsToTab(tabId) {
  if (currentActiveAlertIds.size === 0) return false;
  const alerts = await getAlerts();
  let anySent = false;
  for (const alertId of currentActiveAlertIds) {
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert || !alert.active) continue;
    if (!(await isTabInjectable(tabId))) continue;

    const sent = await sendToTab(tabId, {
      type: "BREAKEX_SHOW",
      alert: { id: alert.id, name: alert.name, fileUrl: alert.fileUrl, fileDataUrl: alert.fileDataUrl, fileType: alert.fileType }
    });
    if (sent) anySent = true;
  }
  return anySent;
}

// ---- Alarm firing ----

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const alerts = await getAlerts();
  const idx = alerts.findIndex((a) => a.id === alarm.name);
  if (idx === -1) return;
  const alert = alerts[idx];
  if (!alert.active) return;

  const tab = await getBestActiveTab();
  if (!tab) {
    // No eligible tab right now (e.g. only chrome:// pages open). Retry
    // shortly rather than dropping the reminder.
    alerts[idx] = { ...alert, endTime: Date.now() + 60000 };
    await saveAlerts(alerts);
    await scheduleAlarm(alerts[idx]);
    return;
  }

  // Add this alert to the set of currently active reminders
  currentActiveAlertIds.add(alert.id);
  await saveActiveAlertIds(currentActiveAlertIds);

  // Check if the active tab is a new tab page (chrome://newtab, edge://newtab)
  // Content scripts cannot run on these pages, so rely on desktop notification.
  const isNewTab = isNewTabPage(tab.url);

  if (!isNewTab) {
    // Try to show in the current best tab.
    await sendToTab(tab.id, {
      type: "BREAKEX_SHOW",
      alert: {
        id: alert.id,
        name: alert.name,
        fileUrl: alert.fileUrl,
        fileDataUrl: alert.fileDataUrl,
        fileType: alert.fileType
      }
    });
  }

  // Create a desktop notification as a fallback so the user sees the reminder
  // even if the extension popup is open or the content overlay is not visible.
  // This is especially important for new tab pages where we can't inject content.
  try {
    chrome.notifications.create('breakex-' + alert.id, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: alert.name,
      message: 'Time for your break',
      priority: 2
    }, () => {});
  } catch (e) {
    // Notifications permission may not be granted — ignore failures.
    console.warn('BREAKEX: notifications failed', e);
  }
});

// When the user activates a different tab, forward the currently active
// reminders (if any) into that tab so the break popups "follow" them.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await tryForwardActiveAlertsToTab(activeInfo.tabId);
});

// When a new tab is created, show the currently active reminders if the new
// tab is active and injectable. Also handle new tab pages (chrome://newtab, etc.)
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.active) {
    await tryForwardActiveAlertsToTab(tab.id);
  }
});

// When a tab updates (page load or URL change), show the active reminders if it
// is now eligible and the tab is active.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await tryForwardActiveAlertsToTab(tabId);
  }
});

// When a window gains focus, ensure the active alerts (if any) are forwarded to
// the focused window's active tab as well.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (currentActiveAlertIds.size === 0) return;
  const tab = await getBestActiveTab();
  if (!tab) return;
  await tryForwardActiveAlertsToTab(tab.id);
});

// ---- Message handling from popup / options / content scripts ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep the channel open for async sendResponse
});

async function handleMessage(message, sender) {
  const alerts = await getAlerts();

  switch (message.type) {
    case "GET_ALERTS": {
      return { alerts };
    }

    case "SAVE_ALERT": {
      const incoming = message.alert;
      const now = Date.now();
      const idx = alerts.findIndex((a) => a.id === incoming.id);
      if (idx === -1) {
        const newAlert = {
          id: incoming.id || genId(),
          name: incoming.name,
          durationMinutes: incoming.durationMinutes,
          fileUrl: incoming.fileUrl || null,
          fileDataUrl: incoming.fileDataUrl || null,
          fileType: incoming.fileType || null,
          isDefault: false,
          active: true,
          endTime: now + incoming.durationMinutes * 60000
        };
        alerts.push(newAlert);
        await saveAlerts(alerts);
        await scheduleAlarm(newAlert);
      } else {
        const existing = alerts[idx];
        const durationChanged = existing.durationMinutes !== incoming.durationMinutes;
        const updated = {
          ...existing,
          name: incoming.name,
          durationMinutes: incoming.durationMinutes,
          // Only overwrite the file if a new one was actually provided.
          fileUrl: incoming.fileUrl !== undefined ? incoming.fileUrl : existing.fileUrl,
          fileDataUrl: incoming.fileDataUrl !== undefined ? incoming.fileDataUrl : existing.fileDataUrl,
          fileType: incoming.fileType !== undefined ? incoming.fileType : existing.fileType,
          endTime: durationChanged ? now + incoming.durationMinutes * 60000 : existing.endTime
        };
        alerts[idx] = updated;
        await saveAlerts(alerts);
        await scheduleAlarm(updated);
      }
      return { alerts: await getAlerts() };
    }

    case "DELETE_ALERT": {
      const filtered = alerts.filter((a) => a.id !== message.id);
      await saveAlerts(filtered);
      await chrome.alarms.clear(message.id);
      return { alerts: filtered };
    }

    case "TOGGLE_ALERT": {
      const idx = alerts.findIndex((a) => a.id === message.id);
      if (idx !== -1) {
        const alert = alerts[idx];
        const nowActive = !alert.active;
        if (!nowActive) {
          // Pausing: store remaining time so we can resume from where the user left off.
          const remaining = Math.max(0, (alert.endTime || 0) - Date.now());
          alerts[idx] = { ...alert, active: false, pausedRemaining: remaining };
          // Clear the scheduled alarm while paused.
          await saveAlerts(alerts);
          await chrome.alarms.clear(alert.id);
          // If this was a currently active reminder, remove from active set.
          if (currentActiveAlertIds.has(alert.id)) {
            currentActiveAlertIds.delete(alert.id);
            await saveActiveAlertIds(currentActiveAlertIds);
          }
        } else {
          // Resuming: restore remaining time if available, otherwise use full duration.
          // IMPORTANT: Do NOT delete pausedRemaining - keep it for subsequent pauses!
          let remaining = alert.pausedRemaining;
          if (remaining === undefined || remaining === null) remaining = alert.durationMinutes * 60000;
          const newEnd = Date.now() + remaining;
          const updated = { ...alert, active: true, endTime: newEnd };
          // Keep pausedRemaining field so subsequent pauses work correctly.
          alerts[idx] = updated;
          await saveAlerts(alerts);
          await scheduleAlarm(alerts[idx]);
        }
      }
      return { alerts };
    }

    case "BREAKEX_DONE": {
      const idx = alerts.findIndex((a) => a.id === message.id);
      if (idx !== -1) {
        alerts[idx] = { ...alerts[idx], endTime: Date.now() + alerts[idx].durationMinutes * 60000 };
        await saveAlerts(alerts);
        await scheduleAlarm(alerts[idx]);
      }
      // Remove this alert from the active reminders set.
      if (currentActiveAlertIds.has(message.id)) {
        currentActiveAlertIds.delete(message.id);
        await saveActiveAlertIds(currentActiveAlertIds);
      }

      // Tell all tabs to hide any displayed card for this alert so the UI
      // doesn't linger on pages where the user already acted elsewhere.
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          try {
            await sendToTab(t.id, { type: 'BREAKEX_HIDE', id: message.id });
          } catch (e) {
            // ignore per-tab failures
          }
        }
      } catch (e) {
        console.warn('BREAKEX: error while sending hide to tabs', e);
      }

      return { ok: true };
    }

    case "RESET_ALERT": {
      const idx = alerts.findIndex((a) => a.id === message.id);
      if (idx !== -1) {
        alerts[idx] = { ...alerts[idx], endTime: Date.now() + alerts[idx].durationMinutes * 60000 };
        await saveAlerts(alerts);
        await scheduleAlarm(alerts[idx]);
      }
      return { ok: true };
    }

    case "BREAKEX_SNOOZE": {
      const idx = alerts.findIndex((a) => a.id === message.id);
      if (idx !== -1) {
        alerts[idx] = { ...alerts[idx], endTime: Date.now() + SNOOZE_MINUTES * 60000 };
        await saveAlerts(alerts);
        await scheduleAlarm(alerts[idx]);
      }
      // Remove this alert from the active reminders set when snoozed.
      if (currentActiveAlertIds.has(message.id)) {
        currentActiveAlertIds.delete(message.id);
        await saveActiveAlertIds(currentActiveAlertIds);
      }

      // Hide any in-page cards for this alert across tabs.
      try {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          try {
            await sendToTab(t.id, { type: 'BREAKEX_HIDE', id: message.id });
          } catch (e) {}
        }
      } catch (e) {
        console.warn('BREAKEX: error while sending hide to tabs', e);
      }

      return { ok: true };
    }

    default:
      return { error: "Unknown message type" };
  }
}
