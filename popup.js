// BREAKEX popup.js

const listEl = document.getElementById("alertList");
let alerts = [];
let tickTimer = null;

function fmtTime(ms) {
  if (ms <= 0) return "Due now";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m left`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} left`;
}

function thumbHtml(alert) {
  if (alert.fileDataUrl) {
    return `<img src="${alert.fileDataUrl}" alt="" />`;
  }
  return alert.name.toLowerCase().includes("water") ? "💧" : "⏰";
}

function render() {
  if (!alerts.length) {
    listEl.innerHTML = `<div class="brx-empty">No breaks yet. Add your first one below 👇</div>`;
    return;
  }

  listEl.innerHTML = alerts
    .map((a) => {
      const remaining = a.endTime - Date.now();
      return `
        <div class="brx-card ${a.active ? "" : "is-paused"}" data-id="${a.id}">
          <div class="brx-thumb">${thumbHtml(a)}</div>
          <div class="brx-info">
            <div class="brx-name">${escapeHtml(a.name)}</div>
            <div class="brx-timeleft" data-timeleft>${a.active ? fmtTime(remaining) : "Paused"}</div>
          </div>
          <div class="brx-actions">
            <button class="brx-icon-btn" data-action="toggle" title="${a.active ? "Pause" : "Resume"}">${a.active ? "⏸" : "▶"}</button>
            <button class="brx-icon-btn" data-action="edit" title="Edit">✎</button>
            <button class="brx-icon-btn" data-action="delete" title="Delete">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function tickCountdowns() {
  const rows = listEl.querySelectorAll(".brx-card");
  rows.forEach((row) => {
    const id = row.dataset.id;
    const alert = alerts.find((a) => a.id === id);
    if (!alert || !alert.active) return;
    const el = row.querySelector("[data-timeleft]");
    if (el) el.textContent = fmtTime(alert.endTime - Date.now());
  });
}

async function loadAlerts() {
  const res = await chrome.runtime.sendMessage({ type: "GET_ALERTS" });
  alerts = res.alerts || [];
  render();
}

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const card = e.target.closest(".brx-card");
  const id = card.dataset.id;
  const action = btn.dataset.action;

  if (action === "toggle") {
    const res = await chrome.runtime.sendMessage({ type: "TOGGLE_ALERT", id });
    alerts = res.alerts || alerts;
    render();
  } else if (action === "delete") {
    const alert = alerts.find((a) => a.id === id);
    const label = alert ? alert.name : "this break";
    if (confirm(`Delete "${label}"?`)) {
      const res = await chrome.runtime.sendMessage({ type: "DELETE_ALERT", id });
      alerts = res.alerts || alerts;
      render();
    }
  } else if (action === "edit") {
    chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?edit=${encodeURIComponent(id)}`) });
  }
});

document.getElementById("addAlertBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.breakex_alerts) {
    loadAlerts();
  }
});

loadAlerts();
tickTimer = setInterval(tickCountdowns, 1000);
