// BREAKEX options.js

const form = document.getElementById("alertForm");
const alertIdInput = document.getElementById("alertId");
const nameInput = document.getElementById("alertName");
const durationInput = document.getElementById("alertDuration");
const fileInput = document.getElementById("alertFile");
const filePreview = document.getElementById("filePreview");
const filePreviewImg = document.getElementById("filePreviewImg");
const clearFileBtn = document.getElementById("clearFileBtn");
const formTitle = document.getElementById("formTitle");
const submitBtn = document.getElementById("submitBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const listEl = document.getElementById("alertsList");

let alerts = [];
let pendingFileDataUrl = undefined; // undefined = unchanged, null = cleared, string = new file
let pendingFileType = undefined;
let pendingFileUrl = undefined; // for extension asset URLs

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadAlerts() {
  const res = await chrome.runtime.sendMessage({ type: "GET_ALERTS" });
  alerts = res.alerts || [];
  renderList();
  resetForm();
}

function renderList() {
  if (!alerts.length) {
    listEl.innerHTML = `<div class="brx-empty-note">No breaks configured yet.</div>`;
    return;
  }

  listEl.innerHTML = alerts
    .map((a) => {
      // Resolve thumbnail: fileUrl (extension asset) > fileDataUrl (user upload) > emoji fallback
      const thumbUrl = a.fileUrl ? chrome.runtime.getURL(a.fileUrl) : a.fileDataUrl;
      const thumb = thumbUrl
        ? `<img src="${thumbUrl}" alt="" />`
        : a.name.toLowerCase().includes("water")
        ? "💧"
        : "⏰";
      return `
        <div class="brx-o-row" data-id="${a.id}">
          <div class="brx-o-thumb">${thumb}</div>
          <div class="brx-o-meta">
            <div class="brx-o-name">${escapeHtml(a.name)} ${a.isDefault ? '<span class="brx-o-badge">Default</span>' : ""}</div>
            <div class="brx-o-sub">Every ${a.durationMinutes} min · ${a.active ? "Active" : "Paused"}</div>
          </div>
          <div class="brx-o-row-actions">
            <button data-action="toggle" title="${a.active ? "Pause" : "Resume"}">${a.active ? "⏸" : "▶"}</button>
            <button data-action="reset" title="Reset timer">⟳</button>
            <button data-action="edit" title="Edit">✎</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function resetForm() {
  form.reset();
  alertIdInput.value = "";
  // IMPORTANT: Set to undefined to signal "no change" for existing alert,
  // but we need to track if user explicitly cleared the file.
  // The form is now in "add new" mode, so no file should be attached.
  pendingFileDataUrl = undefined;
  pendingFileType = undefined;
  pendingFileUrl = undefined;
  fileInput.value = "";
  filePreview.hidden = true;
  filePreviewImg.src = "";
  formTitle.textContent = "Manage Breaks";
  submitBtn.textContent = "Save Break";
  cancelEditBtn.hidden = true;
  history.replaceState(null, "", "options.html");
}

function startEdit(alert) {
  alertIdInput.value = alert.id;
  nameInput.value = alert.name;
  durationInput.value = alert.durationMinutes;
  pendingFileDataUrl = undefined;
  pendingFileType = undefined;
  pendingFileUrl = alert.fileUrl || undefined;
  fileInput.value = "";

  // Show preview for either fileUrl (default asset) or fileDataUrl (user upload)
  const previewUrl = alert.fileUrl ? chrome.runtime.getURL(alert.fileUrl) : alert.fileDataUrl;
  if (previewUrl) {
    filePreview.hidden = false;
    filePreviewImg.src = previewUrl;
  } else {
    filePreview.hidden = true;
  }

  formTitle.textContent = `Edit "${alert.name}"`;
  submitBtn.textContent = "Update Break";
  cancelEditBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingFileDataUrl = reader.result;
    pendingFileType = file.type === "image/gif" ? "gif" : "image";
    // Clear any pending fileUrl when user uploads a new file
    pendingFileUrl = undefined;
    filePreview.hidden = false;
    filePreviewImg.src = pendingFileDataUrl;
  };
  reader.readAsDataURL(file);
});

clearFileBtn.addEventListener("click", () => {
  // Set to null to explicitly indicate "user wants to remove the file"
  pendingFileDataUrl = null;
  pendingFileType = null;
  pendingFileUrl = null;
  fileInput.value = "";
  filePreviewImg.src = "";
  filePreview.hidden = true;
});

cancelEditBtn.addEventListener("click", resetForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const durationMinutes = Number(durationInput.value);
  const existingId = alertIdInput.value;

  // Check for duplicate name (case-insensitive), excluding the current alert being edited
  const isDuplicate = alerts.some(
    (a) => a.id !== existingId && a.name.toLowerCase() === name.toLowerCase()
  );
  if (isDuplicate) {
    alert("An alert with this name already exists. Please choose a different name.");
    nameInput.focus();
    return;
  }

  const alertPayload = {
    id: existingId || undefined,
    name,
    durationMinutes
  };
  // pendingFileDataUrl can be:
  // - undefined: user didn't touch file input (keep existing file if editing)
  // - null: user explicitly clicked "Remove file"
  // - string (data URL): user selected a new file
  if (pendingFileDataUrl !== undefined) {
    alertPayload.fileDataUrl = pendingFileDataUrl; // null or string
    alertPayload.fileType = pendingFileType; // null or string
  }
  // pendingFileUrl for extension assets (default alerts)
  if (pendingFileUrl !== undefined) {
    alertPayload.fileUrl = pendingFileUrl; // null or string
  }

  const res = await chrome.runtime.sendMessage({ type: "SAVE_ALERT", alert: alertPayload });
  alerts = res.alerts || alerts;
  renderList();
  resetForm();
});

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const row = e.target.closest(".brx-o-row");
  const id = row.dataset.id;
  const action = btn.dataset.action;
  const alert = alerts.find((a) => a.id === id);

  if (action === "toggle") {
    const res = await chrome.runtime.sendMessage({ type: "TOGGLE_ALERT", id });
    alerts = res.alerts || alerts;
    renderList();
  } else if (action === "reset") {
    await chrome.runtime.sendMessage({ type: "RESET_ALERT", id });
    loadAlerts();
  } else if (action === "edit") {
    if (alert) startEdit(alert);
  }
});

loadAlerts();

// Keep the list in sync if another page (popup or background) updates storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.breakex_alerts) {
    loadAlerts();
  }
});
