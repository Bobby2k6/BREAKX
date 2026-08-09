// BREAKEX content.js
// Injected into every page. Renders a stack of glass "toast" cards near
// the top-right (below the toolbar / extension icon) whenever background.js
// tells us an alert has fired. Multiple alerts stack vertically, each with
// its own independent Done / Remind me in 5 min buttons.

(function () {
  if (window.__breakexContentLoaded) return;
  window.__breakexContentLoaded = true;

  const CONTAINER_ID = "breakex-container";

  function ensureContainer() {
    let el = document.getElementById(CONTAINER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = CONTAINER_ID;
      // Use document.body instead of documentElement to avoid issues with
      // pages that have complex documentElement styling
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function removeCard(card) {
    card.classList.add("breakex-card-out");
    setTimeout(() => card.remove(), 280);
  }

  function showAlertCard(alert) {
    const container = ensureContainer();

    // Avoid stacking duplicate cards for the same alert id.
    // Check BEFORE creating any elements to prevent race conditions.
    const existing = container.querySelector(`.breakex-card[data-id="${CSS.escape(alert.id)}"]`);
    if (existing) return;

    const card = document.createElement("div");
    card.className = "breakex-card";
    card.dataset.id = alert.id;

    // Resolve image URL: fileUrl (extension asset) takes priority, then fileDataUrl (user upload)
    const imageUrl = alert.fileUrl ? chrome.runtime.getURL(alert.fileUrl) : alert.fileDataUrl;

    let mediaHtml = "";
    if (imageUrl) {
      const isGif = alert.fileType === "gif" || imageUrl.endsWith(".gif");
      const isSvg = alert.fileType === "svg" || imageUrl.endsWith(".svg");
      if (isGif) {
        mediaHtml = `<div class="breakex-media"><img src="${imageUrl}" class="breakex-gif" alt=""/></div>`;
      } else if (isSvg) {
        mediaHtml = `<div class="breakex-media"><img src="${imageUrl}" class="breakex-svg" alt=""/></div>`;
      } else {
        mediaHtml = `<div class="breakex-media"><img src="${imageUrl}" class="breakex-fade-img" alt=""/></div>`;
      }
    } else {
      mediaHtml = `<div class="breakex-media breakex-media-emoji"><span>⏰</span></div>`;
    }

    card.innerHTML = `
      ${mediaHtml}
      <div class="breakex-body">
        <div class="breakex-title">${escapeHtml(alert.name)}</div>
        <div class="breakex-subtitle">Time for your break</div>
        <div class="breakex-actions">
          <button type="button" class="breakex-btn breakex-btn-done" aria-label="Mark as done">Done</button>
          <button type="button" class="breakex-btn breakex-btn-snooze" aria-label="Remind me in 5 minutes">Remind me in 5 min</button>
        </div>
      </div>
    `;

    container.appendChild(card);

    // Trigger the fade-in on next frame so the CSS transition applies.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => card.classList.add("breakex-card-in"));
    });

    card.querySelector(".breakex-btn-done").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "BREAKEX_DONE", id: alert.id });
      removeCard(card);
    });

    card.querySelector(".breakex-btn-snooze").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "BREAKEX_SNOOZE", id: alert.id });
      removeCard(card);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "BREAKEX_SHOW" && message.alert) {
      showAlertCard(message.alert);
      sendResponse({ ok: true });
    } else if (message.type === 'BREAKEX_HIDE' && message.id) {
      // Remove any card for this alert id (used when user acted in another tab).
      const container = document.getElementById(CONTAINER_ID);
      if (container) {
        const card = container.querySelector(`.breakex-card[data-id="${CSS.escape(message.id)}"]`);
        if (card) removeCard(card);
      }
      sendResponse({ ok: true });
    }
    return false;
  });
})();
