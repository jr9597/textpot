/**
 * Textpot dashboard — renders search results and manages chat.
 *
 * Receives progress messages from background.js via chrome.runtime.onMessage.
 * Calls POST /chat directly for follow-up questions.
 *
 * CONFIGURE: Set BACKEND_URL to match background.js.
 *   Local dev: "http://localhost:8080"
 *   Production: "https://YOUR-SERVICE-XXXX-uc.a.run.app"
 */
const BACKEND_URL = "https://textpot-backend-537575138673.us-central1.run.app";

// Source metadata for rendering (flag, name, language)
const _img = (file) => `<img src="${chrome.runtime.getURL(`icons/${file}`)}" width="18" height="18" style="border-radius:3px;object-fit:contain">`;

const SOURCES = {
  naver:      { id: "naver",      name: "Naver",       flag: "🇰🇷", language: "Korean" },
  yahoo_japan:{ id: "yahoo_japan",name: "Yahoo Japan",  flag: "🇯🇵", language: "Japanese" },
  baidu:      { id: "baidu",      name: "Baidu",        flag: "🇨🇳", language: "Chinese" },
  dcard:      { id: "dcard",      name: "Dcard",        flag: "🇹🇼", language: "Traditional Chinese" },
  seznam:     { id: "seznam",     name: "Seznam",       flag: "🇨🇿", language: "Czech" },
  reddit:     { id: "reddit",     name: "Reddit",       flag: _img("reddit.png"),  language: "English" },
  threads:    { id: "threads",    name: "Threads",      flag: _img("threads.png"), language: "English" },
  x:          { id: "x",         name: "X (Twitter)",  flag: "𝕏",                language: "English" },
  youtube:    { id: "youtube",    name: "YouTube",      flag: _img("youtube.png"), language: "English" },
  instagram:  { id: "instagram",  name: "Instagram",    flag: "📸",                language: "English" },
};

const SOURCE_GROUPS = [
  { label: "Local Search", ids: ["naver", "yahoo_japan", "baidu", "dcard", "seznam"] },
  { label: "Social Media", ids: ["reddit", "threads", "x", "youtube", "instagram"] },
];

// App state
let selectedSources = new Set(["reddit", "naver"]);
let isSearching = false;
let collectedResults = {};
let chatHistory = [];
let searchDone = false;

// DOM refs
const queryInput = document.getElementById("queryInput");
const searchBtn = document.getElementById("searchBtn");
const sourcePills = document.getElementById("sourcePills");
const resultsSection = document.getElementById("resultsSection");
const resultsGrid = document.getElementById("resultsGrid");
const emptyState = document.getElementById("emptyState");
const synthesisSection = document.getElementById("synthesisSection");
const synthesisContent = document.getElementById("synthesisContent");
const chatSection = document.getElementById("chatSection");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

// ── Initialisation ────────────────────────────────────────────────────────

function init() {
  renderPills();
  bindEvents();
  listenForBackground();
}

function renderPills() {
  sourcePills.innerHTML = "";
  for (const group of SOURCE_GROUPS) {
    const row = document.createElement("div");
    row.className = "pill-group";
    row.innerHTML = `<span class="pill-group-label">${group.label}</span>`;
    for (const id of group.ids) {
      const src = SOURCES[id];
      if (!src) continue;
      const pill = document.createElement("div");
      pill.className = "pill" + (selectedSources.has(id) ? " active" : "");
      pill.dataset.sourceId = id;
      pill.innerHTML = `
        <span class="status-dot"></span>
        <span>${src.flag}</span>
        <span>${src.name}</span>
      `;
      pill.addEventListener("click", () => toggleSource(id, pill));
      row.appendChild(pill);
    }
    sourcePills.appendChild(row);
  }
}

function toggleSource(id, pill) {
  if (isSearching) return;
  if (selectedSources.has(id)) {
    selectedSources.delete(id);
    pill.classList.remove("active");
  } else {
    selectedSources.add(id);
    pill.classList.add("active");
  }
}

function bindEvents() {
  searchBtn.addEventListener("click", startSearch);
  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startSearch();
  });
  chatSendBtn.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });
}

// ── Search ────────────────────────────────────────────────────────────────

function startSearch() {
  const query = queryInput.value.trim();
  if (!query) return;
  if (selectedSources.size === 0) {
    alert("Select at least one source.");
    return;
  }
  if (isSearching) return;

  // Reset state
  isSearching = true;
  collectedResults = {};
  chatHistory = [];
  searchDone = false;
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching…";

  emptyState.classList.add("hidden");
  chatSection.classList.add("hidden");
  synthesisSection.classList.add("hidden");
  chatMessages.innerHTML = "";

  // Show results section with loading skeletons
  resultsSection.classList.remove("hidden");
  resultsGrid.innerHTML = "";
  for (const id of selectedSources) {
    const src = SOURCES[id];
    const card = createLoadingCard(id, src);
    resultsGrid.appendChild(card);
    setPillStatus(id, "loading");
  }

  // Show synthesis placeholder
  synthesisSection.classList.remove("hidden");
  synthesisContent.innerHTML = '<span class="synthesis-loading">Synthesizing results…</span>';

  // Ask background.js to start the search
  chrome.runtime.sendMessage({
    type: "START_SEARCH",
    query,
    sources: [...selectedSources],
  });
}

// ── Background message listener ───────────────────────────────────────────

function listenForBackground() {
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case "STATUS":
        handleStatus(msg);
        break;
      case "RESULT":
        handleResult(msg);
        break;
      case "SYNTHESIS":
        handleSynthesis(msg);
        break;
      case "ALL_DONE":
        handleAllDone();
        break;
    }
  });
}

function handleStatus(msg) {
  setPillStatus(msg.sourceId, msg.status);
  if (msg.status === "error") {
    replaceCardWithError(msg.sourceId);
  }
}

function handleResult(msg) {
  const { sourceId, result } = msg;
  collectedResults[sourceId] = result;
  setPillStatus(sourceId, "done");
  replaceCardWithResult(sourceId, result);
}

function handleSynthesis(msg) {
  synthesisContent.textContent = msg.content;
}

function handleAllDone() {
  isSearching = false;
  searchDone = true;
  searchBtn.disabled = false;
  searchBtn.textContent = "Search";

  if (Object.keys(collectedResults).length > 0) {
    chatSection.classList.remove("hidden");
    addChatMsg("assistant", "I've analyzed the results above. Ask me anything about them!");
  }

  // Reset pill loading states
  for (const id of selectedSources) {
    const pill = getPill(id);
    if (pill && !pill.classList.contains("done") && !pill.classList.contains("error")) {
      setPillStatus(id, "done");
    }
  }
}

// ── Card rendering ────────────────────────────────────────────────────────

function createLoadingCard(id, src) {
  const card = document.createElement("div");
  card.className = "source-card";
  card.id = `card-${id}`;
  card.innerHTML = `
    <div class="source-card-header">
      <span class="source-flag">${src.flag}</span>
      <div>
        <div class="source-card-name">${src.name}</div>
        <div class="source-lang">${src.language}</div>
      </div>
    </div>
    <div class="skeleton">
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line short"></div>
    </div>
  `;
  return card;
}

function replaceCardWithResult(sourceId, result) {
  const card = document.getElementById(`card-${sourceId}`);
  if (!card) return;

  const src = SOURCES[sourceId] || { flag: "", name: sourceId, language: "" };
  const data = result.data || {};
  const items = data.results || [];
  const sentiment = data.overall_sentiment || { positive: 0, neutral: 100, negative: 0 };
  const quotes = data.representative_quotes || [];

  let itemsHtml = "";
  for (const item of items.slice(0, 5)) {
    const titleHtml = item.url && item.url !== "null"
      ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`
      : `<span style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">${escapeHtml(item.title)}</span>`;
    itemsHtml += `
      <div class="result-item">
        ${titleHtml}
        <div class="summary">${escapeHtml(item.summary || "")}</div>
        <span class="sentiment-badge ${item.sentiment || "neutral"}">${item.sentiment || "neutral"}</span>
      </div>
    `;
  }

  let quotesHtml = "";
  if (quotes.length > 0) {
    quotesHtml = `<div class="quotes-list">` +
      quotes.map(q => `<div class="quote-item">"${escapeHtml(q)}"</div>`).join("") +
      `</div>`;
  }

  if (itemsHtml === "") {
    itemsHtml = `<div class="empty-state" style="padding:20px 0;font-size:12px">No results extracted.</div>`;
  }

  card.innerHTML = `
    <div class="source-card-header">
      <span class="source-flag">${result.flag || src.flag}</span>
      <div>
        <div class="source-card-name">${result.name || src.name}</div>
        <div class="source-lang">${result.language || src.language} · ${data.content_type || ""}</div>
      </div>
    </div>
    <div class="sentiment-bar">
      <div class="pos" style="flex:${sentiment.positive}"></div>
      <div class="neu" style="flex:${sentiment.neutral}"></div>
      <div class="neg" style="flex:${sentiment.negative}"></div>
    </div>
    <div class="result-items">${itemsHtml}</div>
    ${quotesHtml}
  `;
}

function replaceCardWithError(sourceId) {
  const card = document.getElementById(`card-${sourceId}`);
  if (!card) return;
  const src = SOURCES[sourceId] || { flag: "", name: sourceId, language: "" };
  card.innerHTML = `
    <div class="source-card-header">
      <span class="source-flag">${src.flag}</span>
      <div>
        <div class="source-card-name">${src.name}</div>
        <div class="source-lang" style="color:var(--red)">Error</div>
      </div>
    </div>
    <div class="empty-state" style="padding:20px 0;font-size:12px;color:var(--red)">
      Failed to retrieve results.
    </div>
  `;
}

// ── Pill helpers ──────────────────────────────────────────────────────────

function getPill(sourceId) {
  return sourcePills.querySelector(`[data-source-id="${sourceId}"]`);
}

function setPillStatus(sourceId, status) {
  const pill = getPill(sourceId);
  if (!pill) return;
  pill.classList.remove("loading", "done", "error");
  if (status === "loading" || status === "done" || status === "error") {
    pill.classList.add(status);
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !searchDone) return;

  chatInput.value = "";
  chatSendBtn.disabled = true;
  addChatMsg("user", msg);
  chatHistory.push({ role: "user", content: msg });

  const thinkingEl = addChatMsg("thinking", "Thinking…");

  try {
    // Build results payload from collected data
    const resultsPayload = {};
    for (const [id, r] of Object.entries(collectedResults)) {
      resultsPayload[id] = r.data || r;
    }

    const res = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        results: resultsPayload,
        history: chatHistory.slice(0, -1), // exclude the message we just added
      }),
    });
    const data = await res.json();
    const reply = data.content || "No response.";

    thinkingEl.remove();
    addChatMsg("assistant", reply);
    chatHistory.push({ role: "assistant", content: reply });
  } catch (err) {
    thinkingEl.remove();
    addChatMsg("assistant", `Error: ${err.message}`);
  } finally {
    chatSendBtn.disabled = false;
    chatInput.focus();
  }
}

function addChatMsg(role, text) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

// ── Utils ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}

// ── Boot ──────────────────────────────────────────────────────────────────
init();
