/**
 * Textpot Extension — Background Service Worker
 *
 * Flow per source:
 *   1. Open search results page (background tab)
 *   2. Attach Chrome Debugger + set fixed viewport
 *   3. Run Gemini Computer Use loop:
 *        screenshot → POST /computer-use-step → execute actions via CDP → repeat
 *   4. Receive structured JSON result from Gemini (done=true)
 *   5. Send RESULT to dashboard, close tab + detach debugger
 *   6. After all sources done: POST /synthesize → ALL_DONE to dashboard
 *
 * CONFIGURE: Set BACKEND_URL to your deployed Cloud Run service URL.
 */
const BACKEND_URL = "https://textpot-backend-537575138673.us-central1.run.app";

const SOURCES = {
  naver: {
    id: "naver",
    name: "Naver",
    flag: "🇰🇷",
    language: "Korean",
    url: (q) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}&where=post`,
  },
  yahoo_japan: {
    id: "yahoo_japan",
    name: "Yahoo Japan",
    flag: "🇯🇵",
    language: "Japanese",
    url: (q) => `https://news.yahoo.co.jp/search?p=${encodeURIComponent(q)}`,
  },
  baidu: {
    id: "baidu",
    name: "Baidu",
    flag: "🇨🇳",
    language: "Chinese",
    url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=10`,
  },
  dcard: {
    id: "dcard",
    name: "Dcard",
    flag: "🇹🇼",
    language: "Traditional Chinese",
    url: (q) => `https://www.dcard.tw/search?query=${encodeURIComponent(q)}`,
  },
  seznam: {
    id: "seznam",
    name: "Seznam",
    flag: "🇨🇿",
    language: "Czech",
    url: (q) => `https://search.seznam.cz/?q=${encodeURIComponent(q)}`,
  },
  reddit: {
    id: "reddit",
    name: "Reddit",
    flag: `<img src="${chrome.runtime.getURL("icons/reddit.png")}" width="18" height="18" style="border-radius:3px;object-fit:contain">`,
    language: "English",
    url: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=top&t=year`,
  },
  threads: {
    id: "threads",
    name: "Threads",
    flag: `<img src="${chrome.runtime.getURL("icons/threads.png")}" width="18" height="18" style="border-radius:3px;object-fit:contain">`,
    language: "English",
    url: (q) => `https://www.threads.net/search?q=${encodeURIComponent(q)}&serp_type=default`,
  },
  x: {
    id: "x",
    name: "X (Twitter)",
    flag: "𝕏",
    language: "English",
    url: (q) => `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`,
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    flag: `<img src="${chrome.runtime.getURL("icons/youtube.png")}" width="18" height="18" style="border-radius:3px;object-fit:contain">`,
    language: "English",
    url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    flag: "📸",
    language: "English",
    url: (q) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`,
  },
};

// Fixed viewport for Gemini Computer Use — coordinates are normalised 0-1000
// relative to this size.
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

let dashboardTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OPEN_DASHBOARD") {
    openDashboard();
    sendResponse({ ok: true });
  } else if (msg.type === "START_SEARCH") {
    dashboardTabId = sender.tab?.id ?? null;
    startSearch(msg.query, msg.sources).catch((err) =>
      console.error("startSearch error:", err)
    );
    sendResponse({ ok: true });
  } else if (msg.type === "GET_BACKEND_URL") {
    sendResponse({ url: BACKEND_URL });
  }
  return true;
});

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html"), active: true });
}

// ── Task prompt for Gemini Computer Use ───────────────────────────────────

function buildTask(source, query) {
  return `You are already on a ${source.name} search results page showing results for "${query}" in ${source.language}. Do NOT search again — you are already on the correct page.

IMPORTANT: If you see any modal dialog, login prompt, "Sign in to continue", "Open in app" banner, cookie consent, or any overlay — dismiss it immediately by clicking the close/X button or pressing Escape. Do NOT attempt to log in or sign up.

Your task:
1. Read the visible posts and results on this page.
2. Click into the top 3 results one by one — read each page's content, user comments, and reactions, then press the back button to return to the results page.
3. Total: 3 results — prioritise posts with user opinions, reactions, and discussions over plain news.

IMPORTANT: Do NOT click any "Translate", "See translation", or language toggle buttons. You can read and understand any language directly — clicking translate wastes steps and causes unnecessary page changes.

For EACH result extract:
- title: translated to English
- summary: 2-3 sentence English summary of what users are saying or what the post argues
- url: the direct link — check the address bar after clicking, breadcrumbs, or visible URL text under the title; construct the full URL if only a partial path is visible
- image_url: thumbnail or hero image URL if visible, else null
- sentiment: "positive", "neutral", or "negative" toward the topic

Return ONLY this JSON — no markdown fences, no explanation:
{
  "content_type": "forum_comments",
  "results": [
    {"title":"...","summary":"...","url":"...","image_url":null,"sentiment":"positive"}
  ],
  "overall_sentiment": {"positive": 60, "neutral": 25, "negative": 15},
  "representative_quotes": ["quote 1","quote 2","quote 3"]
}

Replace content_type with "news_articles", "blog_posts", or "forum_comments" based on what you observe.
Sentiment percentages must sum to 100. Return minimum 1 result even if content is sparse.
If after several attempts you cannot get more content, return the JSON with whatever you have collected so far.`;
}

// ── Main search orchestration ─────────────────────────────────────────────

async function startSearch(query, sourceIds) {
  // Translate query into all required languages in parallel
  const uniqueLangs = [
    ...new Set(sourceIds.map((id) => SOURCES[id]?.language).filter(Boolean)),
  ];
  const translations = {};
  await Promise.allSettled(
    uniqueLangs.map(async (lang) => {
      if (lang.toLowerCase() === "english") {
        translations[lang] = query;
        return;
      }
      try {
        const res = await fetch(`${BACKEND_URL}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, language: lang }),
        });
        const data = await res.json();
        translations[lang] = data.translated ?? query;
      } catch {
        translations[lang] = query;
      }
    })
  );

  const results = {};

  await Promise.allSettled(
    sourceIds.map(async (sourceId) => {
      const source = SOURCES[sourceId];
      if (!source) return;

      const translatedQuery = translations[source.language] ?? query;
      sendToDashboard({ type: "STATUS", sourceId, status: "loading" });

      try {
        const result = await scrapeWithComputerUse(sourceId, source, translatedQuery);

        if (result && result.data) {
          results[sourceId] = result.data;
          sendToDashboard({ type: "RESULT", sourceId, result });
        } else {
          sendToDashboard({ type: "STATUS", sourceId, status: "error", error: "No data extracted" });
        }
      } catch (err) {
        console.error(`Source ${sourceId} failed:`, err);
        sendToDashboard({ type: "STATUS", sourceId, status: "error", error: String(err) });
      }
    })
  );

  if (Object.keys(results).length > 0) {
    try {
      const res = await fetch(`${BACKEND_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, results }),
      });
      const data = await res.json();
      sendToDashboard({ type: "SYNTHESIS", content: data.content });
    } catch (err) {
      console.error("Synthesis failed:", err);
      sendToDashboard({ type: "SYNTHESIS", content: "Synthesis unavailable." });
    }
  }

  sendToDashboard({ type: "ALL_DONE" });
}

// ── Gemini Computer Use scraping loop ────────────────────────────────────

async function scrapeWithComputerUse(sourceId, source, translatedQuery) {
  // Open in a popup window instead of a background tab — popup windows are not
  // subject to Chrome's background tab throttling/freezing, which would cause
  // Page.captureScreenshot to return stale frames and Gemini to loop forever.
  const win = await chrome.windows.create({
    url: source.url(translatedQuery),
    type: "popup",
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT + 88, // +88 for OS window chrome
    focused: false,
  });
  const tabId = win.tabs[0].id;
  const winId = win.id;

  await waitForTabLoad(tabId);
  await sleep(2500); // let SPA render

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    console.warn(`[${sourceId}] Debugger attach failed:`, err);
    try { await chrome.windows.remove(winId); } catch {}
    return null;
  }

  try {
    // Pin viewport so Gemini's normalised 0-1000 coordinates map correctly.
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Prevent Chrome from freezing the page when the window is in the background.
    // Without this, captureScreenshot returns stale frames when the user looks away.
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", { state: "active" });
    } catch {}  // not available in all Chrome versions — best-effort
    await sleep(300);

    const task = buildTask(source, translatedQuery);

    const { data: initialScreenshot } = await chrome.debugger.sendCommand(
      { tabId }, "Page.captureScreenshot", { format: "png" }
    );

    let sessionId = null;
    let currentScreenshot = initialScreenshot;
    let actionResults = null;
    let resultJson = null;

    for (let turn = 0; turn < 30; turn++) {
      // First call: no session_id, send task + screenshot.
      // Subsequent calls: send session_id + action results + new screenshot.
      const body = sessionId === null
        ? { task, screenshot_b64: currentScreenshot }
        : { session_id: sessionId, screenshot_b64: currentScreenshot, action_results: actionResults };

      let stepRes;
      try {
        const res = await fetch(`${BACKEND_URL}/computer-use-step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        stepRes = await res.json();
      } catch (err) {
        console.warn(`[${sourceId}] /computer-use-step failed on turn ${turn}:`, err);
        break;
      }

      const { session_id, actions, done, result_json } = stepRes;
      if (sessionId === null) sessionId = session_id;

      if (done) {
        resultJson = result_json;
        break;
      }

      if (!actions || actions.length === 0) {
        console.warn(`[${sourceId}] No actions and not done — stopping`);
        break;
      }

      // Execute each action via Chrome Debugger Protocol
      actionResults = [];
      for (const action of actions) {
        try {
          await executeDebuggerAction(tabId, action);
        } catch (err) {
          console.warn(`[${sourceId}] Action ${action.name} failed:`, err);
        }
        await sleep(1000);
        const url = await getTabUrl(tabId);
        actionResults.push({ id: action.id, name: action.name, result: "success", url });
      }

      // Capture new screenshot for next turn
      try {
        const { data } = await chrome.debugger.sendCommand(
          { tabId }, "Page.captureScreenshot", { format: "png" }
        );
        currentScreenshot = data;
      } catch (err) {
        console.warn(`[${sourceId}] Screenshot failed on turn ${turn}:`, err);
        break;
      }
    }

    if (!resultJson) return null;

    return { data: resultJson, flag: source.flag, language: source.language, name: source.name };

  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    try { await chrome.windows.remove(winId); } catch {}
  }
}

// ── CDP action executor ───────────────────────────────────────────────────

function normX(x) { return Math.round((x / 1000) * VIEWPORT_WIDTH); }
function normY(y) { return Math.round((y / 1000) * VIEWPORT_HEIGHT); }

async function executeDebuggerAction(tabId, action) {
  const { name, args = {} } = action;

  if (name === "click_at" || name === "computer_use_click") {
    let x, y;
    if (name === "computer_use_click") {
      const coord = args.coordinate || [500, 400];
      x = normX(coord[0]); y = normY(coord[1]);
    } else {
      x = normX(args.x ?? 500); y = normY(args.y ?? 400);
    }
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
    try { await waitForTabLoad(tabId); } catch {}

  } else if (name === "navigate" || name === "open_web_browser") {
    const url = args.url || "";
    if (url) {
      await chrome.tabs.update(tabId, { url });
      await sleep(500);
      await waitForTabLoad(tabId);
    }

  } else if (name === "type_text_at" || name === "computer_use_type") {
    if (name === "type_text_at" && args.x != null && args.y != null) {
      const x = normX(args.x), y = normY(args.y);
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
        { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
        { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      await sleep(200);
    }
    const text = args.text || "";
    if (text) {
      await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
    }
    if (args.press_enter_after) {
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
        { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
        { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await sleep(500);
      try { await waitForTabLoad(tabId); } catch {}
    }

  } else if (name === "key_combination" || name === "computer_use_key") {
    const key = args.key || "";
    if (key) {
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
        { type: "keyDown", key, code: key });
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
        { type: "keyUp", key, code: key });
    }
    if (key === "Return" || key === "Enter") {
      await sleep(500);
      try { await waitForTabLoad(tabId); } catch {}
    }

  } else if (name === "scroll" || name === "scroll_document") {
    const x = name === "scroll_document" ? VIEWPORT_WIDTH / 2 : normX(args.x ?? 500);
    const y = name === "scroll_document" ? VIEWPORT_HEIGHT / 2 : normY(args.y ?? 400);
    const direction = args.direction || "down";
    const amount = (args.amount ?? 3) * 120;
    const deltaX = direction === "right" ? amount : direction === "left" ? -amount : 0;
    const deltaY = direction === "down" ? amount : direction === "up" ? -amount : 0;
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mouseWheel", x, y, deltaX, deltaY });

  } else if (name === "go_back") {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate",
      { expression: "window.history.back()" });
    await sleep(1000);
    try { await waitForTabLoad(tabId); } catch {}

  } else if (name === "drag_and_drop") {
    // Used for slider CAPTCHAs
    const sx = normX(args.start_x ?? args.x ?? 200);
    const sy = normY(args.start_y ?? args.y ?? 500);
    const ex = normX(args.end_x ?? args.target_x ?? (args.x ?? 200) + 260);
    const ey = normY(args.end_y ?? args.target_y ?? args.y ?? 500);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mousePressed", x: sx, y: sy, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 20; i++) {
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(sx + (ex - sx) * i / 20),
        y: Math.round(sy + (ey - sy) * i / 20),
        button: "left", buttons: 1,
      });
      await sleep(25);
    }
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent",
      { type: "mouseReleased", x: ex, y: ey, button: "left", buttons: 0, clickCount: 1 });

  } else if (name === "search") {
    const q = args.query || args.text || "";
    if (q) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
          expression: `(function(){
            const inp = document.querySelector('input[type=search], input[type=text], input:not([type])');
            if (inp) { inp.focus(); inp.select(); }
          })()`,
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: q });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
          { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await sleep(500);
        try { await waitForTabLoad(tabId); } catch {}
      } catch {}
    }

  } else if (name === "wait_5_seconds") {
    await sleep(3000);

  } else if (name === "screenshot" || name === "computer_use_screenshot") {
    // No-op — screenshots are captured separately after each action batch

  } else {
    console.warn(`[computer-use] Unhandled action: ${name}`, args);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function getTabUrl(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => resolve(tab?.url || ""));
  });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout after 30s"));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (tab && tab.status === "complete") {
        clearTimeout(timeout);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendToDashboard(msg) {
  if (dashboardTabId !== null) {
    chrome.tabs.sendMessage(dashboardTabId, msg).catch(() => {});
  }
}
