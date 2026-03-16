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
const _img = (file) => `<img src="${chrome.runtime.getURL(`icons/${file}`)}" style="border-radius:3px;object-fit:contain">`;

const SOURCES = {
  reddit:    { id: "reddit",    name: "Reddit",      flag: _img("reddit.png"),  language: "English" },
  threads:   { id: "threads",   name: "Threads",     flag: _img("threads.png"), language: "English" },
  x:         { id: "x",        name: "X (Twitter)", flag: "𝕏",                language: "English" },
  youtube:   { id: "youtube",   name: "YouTube",     flag: _img("youtube.png"), language: "English" },
  instagram: { id: "instagram", name: "Instagram",   flag: "📸",                language: "English" },
  tiktok:    { id: "tiktok",    name: "TikTok",      flag: _img("tiktok.png"),  language: "English" },
};

const SOURCE_GROUPS = [
  { label: "Social Media", ids: ["reddit", "threads", "x", "youtube", "instagram", "tiktok"] },
];

// App state
let selectedSources = new Set();
let isSearching = false;
let collectedResults = {};
let chatHistory = [];
let searchDone = false;
let sourcesOpen = false;

// DOM refs
const appEl         = document.getElementById("app");
const queryInput    = document.getElementById("queryInput");
const searchBtn     = document.getElementById("searchBtn");
const sourcesToggle = document.getElementById("sourcesToggle");
const sourcesDropdown = document.getElementById("sourcesDropdown");
const sourcesLabel  = document.getElementById("sourcesLabel");
const sourcePills   = document.getElementById("sourcePills");
const resultsSection   = document.getElementById("resultsSection");
const resultsGrid      = document.getElementById("resultsGrid");
const emptyState       = document.getElementById("emptyState");
const synthesisSection = document.getElementById("synthesisSection");
const synthesisContent = document.getElementById("synthesisContent");
const chatSection   = document.getElementById("chatSection");
const chatMessages  = document.getElementById("chatMessages");
const chatInput     = document.getElementById("chatInput");
const chatSendBtn   = document.getElementById("chatSendBtn");
const overviewSection   = document.getElementById("overviewSection");
const overviewList      = document.getElementById("overviewList");
const divergenceCallout = document.getElementById("divergenceCallout");

// ── Flickering grid background ────────────────────────────────────────────

function initFlickeringGrid() {
  const canvas = document.getElementById("flickerBg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const SQUARE = 4;
  const GAP = 6;
  const CELL = SQUARE + GAP;
  const COLOR = "15,15,15"; // near-black dots on white bg
  const MAX_OPACITY = 0.12;
  const FLICKER_CHANCE = 0.06;

  let cols, rows, squares;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.ceil(canvas.width / CELL) + 1;
    rows = Math.ceil(canvas.height / CELL) + 1;
    squares = new Float32Array(cols * rows);
    for (let i = 0; i < squares.length; i++) {
      squares[i] = Math.random() * MAX_OPACITY;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (Math.random() < FLICKER_CHANCE) {
          squares[idx] = Math.random() * MAX_OPACITY;
        }
        const op = squares[idx];
        if (op < 0.002) continue;
        ctx.fillStyle = `rgba(${COLOR},${op.toFixed(3)})`;
        ctx.fillRect(c * CELL, r * CELL, SQUARE, SQUARE);
      }
    }
    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

// ── Initialisation ────────────────────────────────────────────────────────

function init() {
  initFlickeringGrid();
  renderPills();
  updateSourcesLabel();
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

function updateSourcesLabel() {
  const n = selectedSources.size;
  sourcesLabel.textContent = n === 0 ? "Sources" : `${n} source${n === 1 ? "" : "s"}`;
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
  updateSourcesLabel();
}

function toggleSourcesDropdown() {
  sourcesOpen = !sourcesOpen;
  if (sourcesOpen) {
    sourcesDropdown.classList.remove("hidden");
    sourcesToggle.classList.add("open");
  } else {
    sourcesDropdown.classList.add("hidden");
    sourcesToggle.classList.remove("open");
  }
}

function bindEvents() {
  searchBtn.addEventListener("click", startSearch);
  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startSearch();
  });
  sourcesToggle.addEventListener("click", toggleSourcesDropdown);
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

  // Collapse sources dropdown
  sourcesDropdown.classList.add("hidden");
  sourcesToggle.classList.remove("open");
  sourcesOpen = false;

  // Move hero up
  appEl.classList.add("has-results");

  emptyState.classList.add("hidden");
  chatSection.classList.add("hidden");
  synthesisSection.classList.add("hidden");
  chatMessages.innerHTML = "";

  // Reset overview
  overviewSection.classList.add("hidden");
  overviewList.innerHTML = "";
  divergenceCallout.classList.add("hidden");

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
  synthesisContent.innerHTML = '<span class="analysis-loading">Analyzing results…</span>';

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
  updateOverview();
}

function handleSynthesis(msg) {
  synthesisContent.textContent = msg.content;
}

function handleAllDone() {
  isSearching = false;
  searchDone = true;
  searchBtn.disabled = false;

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

  checkDivergence();
}

// ── Overview ──────────────────────────────────────────────────────────────

function updateOverview() {
  overviewSection.classList.remove("hidden");
  overviewList.innerHTML = "";
  for (const [id, result] of Object.entries(collectedResults)) {
    const src = SOURCES[id] || { flag: "", name: id };
    const data = result.data || {};
    const s = data.overall_sentiment || { positive: 0, neutral: 100, negative: 0 };
    const total = s.positive + s.neutral + s.negative || 100;
    const pos = Math.round((s.positive / total) * 100);
    const neu = Math.round((s.neutral / total) * 100);
    const neg = 100 - pos - neu;

    let dominant, dominantClass;
    if (pos >= neg && pos >= neu) { dominant = `${pos}% positive`; dominantClass = "pos"; }
    else if (neg >= pos && neg >= neu) { dominant = `${neg}% negative`; dominantClass = "neg"; }
    else { dominant = `${neu}% neutral`; dominantClass = "neu"; }

    const row = document.createElement("div");
    row.className = "overview-row";
    row.innerHTML = `
      <div class="overview-source">
        <span class="overview-flag">${src.flag}</span>
        <span class="overview-name">${src.name}</span>
      </div>
      <div class="overview-bar-wrap">
        <div class="pos" style="flex:${s.positive}"></div>
        <div class="neu" style="flex:${s.neutral}"></div>
        <div class="neg" style="flex:${s.negative}"></div>
      </div>
      <span class="overview-dominant ${dominantClass}">${dominant}</span>
    `;
    overviewList.appendChild(row);
  }
  checkDivergence();
}

function checkDivergence() {
  const positives = Object.entries(collectedResults).map(([id, r]) => {
    const s = (r.data || {}).overall_sentiment || { positive: 0 };
    return { id, name: SOURCES[id]?.name || id, pos: s.positive };
  });
  if (positives.length < 2) return;
  const vals = positives.map(p => p.pos);
  const range = Math.max(...vals) - Math.min(...vals);
  if (range < 35) {
    divergenceCallout.classList.add("hidden");
    return;
  }
  const most = positives.reduce((a, b) => a.pos > b.pos ? a : b);
  const least = positives.reduce((a, b) => a.pos < b.pos ? a : b);
  divergenceCallout.classList.remove("hidden");
  divergenceCallout.innerHTML = `
    <span class="div-icon">⚠️</span>
    <span><strong>Notable divergence detected.</strong> ${most.name} skews ${most.pos}% positive while ${least.name} skews ${Math.round(100 - least.pos - ((collectedResults[least.id]?.data?.overall_sentiment?.neutral) || 0))}% negative — suggesting meaningfully different reactions across markets.</span>
  `;
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
  const s = data.overall_sentiment || { positive: 0, neutral: 100, negative: 0 };
  const quotes = data.representative_quotes || [];

  // Sentiment numbers
  const total = s.positive + s.neutral + s.negative || 100;
  const pos = Math.round((s.positive / total) * 100);
  const neu = Math.round((s.neutral / total) * 100);
  const neg = 100 - pos - neu;

  // Quotes HTML
  let quotesHtml = "";
  if (quotes.length > 0) {
    quotesHtml = `<div class="card-quotes">` +
      quotes.slice(0, 3).map(q => `<div class="card-quote">"${escapeHtml(q)}"</div>`).join("") +
      `</div>`;
  }

  // Posts HTML
  let postsHtml = "";
  for (const item of items.slice(0, 5)) {
    const titleHtml = item.url && item.url !== "null"
      ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`
      : `<span style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">${escapeHtml(item.title)}</span>`;
    postsHtml += `
      <div class="result-item">
        ${titleHtml}
        <div class="summary">${escapeHtml(item.summary || "")}</div>
        <span class="sentiment-badge ${item.sentiment || "neutral"}">${item.sentiment || "neutral"}</span>
      </div>
    `;
  }
  if (!postsHtml) postsHtml = `<div style="font-size:12px;color:var(--muted);padding:8px 0">No posts extracted.</div>`;

  const contentTypeBadge = data.content_type
    ? `<span style="font-size:10px;color:var(--muted);font-weight:500">${data.content_type.replace("_", " ")}</span>`
    : "";

  card.innerHTML = `
    <div class="source-card-header">
      <span class="source-flag">${result.flag || src.flag}</span>
      <div style="flex:1">
        <div class="source-card-name">${result.name || src.name}</div>
        <div class="source-lang">${result.language || src.language}</div>
      </div>
      ${contentTypeBadge}
    </div>
    <div class="card-sentiment-display">
      <div class="card-sentiment-bar">
        <div class="pos" style="flex:${s.positive}"></div>
        <div class="neu" style="flex:${s.neutral}"></div>
        <div class="neg" style="flex:${s.negative}"></div>
      </div>
      <div class="card-sentiment-numbers">
        <span class="pos">${pos}% positive</span>
        <span class="neu">${neu}% neutral</span>
        <span class="neg">${neg}% negative</span>
      </div>
    </div>
    ${quotesHtml}
    <div class="card-posts-label">Posts</div>
    <div class="result-items">${postsHtml}</div>
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
        history: chatHistory.slice(0, -1),
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
