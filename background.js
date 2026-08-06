// BREAKEX background.js
// Owns all alert data + chrome.alarms scheduling. The popup, options page,
// and content scripts never touch storage directly — everything routes
// through this service worker so timers keep running even if the popup
// is closed.

const STORAGE_KEY = "breakex_alerts";
const SNOOZE_MINUTES = 5;

const DEFAULT_ALERTS = [
  {
    id: "default-screen-break",
    name: "Screen Break",
    durationMinutes: 20,
    fileDataUrl: null,
    fileType: null,
    isDefault: true,
    active: true,
    endTime: 0
  },
  {
    id: "default-water-break",
    name: "Water Break",
    durationMinutes: 45,
    fileDataUrl: null,
    fileType: null,
    isDefault: true,
    active: true,
    endTime: 0
  }
];

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
      return { ...a, endTime: now + a.durationMinutes * 60000 };
    }
    return a;
  });
  if (changed) await saveAlerts(alerts);
  await rescheduleAllAlarms(alerts);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureInitialized();
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
    tab = null;
  }
  if (tab) return tab;

  // Fall back to any active tab in any window with an injectable URL.
  const allActive = await chrome.tabs.query({ active: true });
  return allActive.find((t) => t.url && !/^(chrome|edge|about|chrome-extension):/i.test(t.url)) || null;
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

  await sendToTab(tab.id, {
    type: "BREAKEX_SHOW",
    alert: {
      id: alert.id,
      name: alert.name,
      fileDataUrl: alert.fileDataUrl,
      fileType: alert.fileType
    }
  });
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
        alerts[idx] = {
          ...alert,
          active: nowActive,
          endTime: nowActive ? Date.now() + alert.durationMinutes * 60000 : alert.endTime
        };
        await saveAlerts(alerts);
        await scheduleAlarm(alerts[idx]);
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
      return { ok: true };
    }

    case "BREAKEX_SNOOZE": {
      const idx = alerts.findIndex((a) => a.id === message.id);
      if (idx !== -1) {
        alerts[idx] = { ...alerts[idx], endTime: Date.now() + SNOOZE_MINUTES * 60000 };
        await saveAlerts(alerts);
        await scheduleAlarm(alerts[idx]);
      }
      return { ok: true };
    }

    default:
      return { error: "Unknown message type" };
  }
}
