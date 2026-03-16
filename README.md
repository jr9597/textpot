# Textpot

**Social media sentiment intelligence — see what the world actually thinks.**

Textpot is a Chrome extension powered by Gemini Computer Use that autonomously browses 6 major social platforms in parallel — Reddit, TikTok, X, Threads, YouTube, and Instagram — extracting authentic public sentiment and synthesizing it into an intelligence dashboard.

> Built for the Google Cloud × Gemini Hackathon

---

## What It Does

Type a query. Select your sources. Textpot opens real browser sessions **in the user's own Chrome** — with their existing logins and cookies — navigates each platform natively, reads comments and discussions, and returns:

- **Per-platform sentiment breakdown** — positive / neutral / negative %
- **Representative quotes** from real users
- **AI synthesis** — patterns and key takeaways across platforms
- **Divergence detection** — flags when platforms significantly disagree
- **Follow-up chat** grounded in the collected results

No scraping APIs. No third-party platform keys. Gemini sees the actual screen and acts like a human user.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Chrome Extension (MV3)                          │
│                                                                          │
│   dashboard.html / js              background.js  (Service Worker)       │
│   ┌─────────────────────┐          ┌───────────────────────────────┐    │
│   │  Prompt Box         │ ───────▶ │ 1. Translate query (parallel) │    │
│   │  Signals Overview   │          │ 2. Open popup window / source │    │
│   │  Divergence Alert   │          │ 3. chrome.debugger attach     │    │
│   │  Source Cards       │          │ 4. Set viewport 1280 × 800    │    │
│   │  AI Analysis        │          │ 5. Page.setWebLifecycleState  │    │
│   │  Follow-up Chat     │          └──────────────┬────────────────┘    │
│   └────────▲────────────┘                         │                     │
│            │ chrome.runtime.onMessage             │ Computer Use Loop   │
│            │ (RESULT / SYNTHESIS / ALL_DONE)      │ (up to 30 turns)    │
│            │                                      ▼                     │
│            │                         ┌────────────────────────┐         │
│            │                         │ Page.captureScreenshot │         │
│            │                         │          ↓             │         │
│            └─────────────────────────│ POST /computer-use-step│         │
│                                      │          ↓             │         │
│                                      │  Gemini interprets     │         │
│                                      │  screenshot → action   │         │
│                                      │          ↓             │         │
│                                      │  Execute via CDP:      │         │
│                                      │  click · type · scroll │         │
│                                      │  go_back · key_combo   │         │
│                                      └────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
                                           │
                                     HTTPS / REST
                                           │
┌──────────────────────────────────────────▼───────────────────────────────┐
│                      FastAPI Backend  —  Google Cloud Run                 │
│                                                                           │
│  POST /translate           gemini-2.5-flash  →  native-language query    │
│                                                                           │
│  POST /computer-use-step                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  _cu_sessions { }  — in-memory store of Gemini SDK objects       │    │
│  │  (avoids JSON serialization of FunctionCall / Content types)     │    │
│  │                                                                  │    │
│  │  Turn N:  [contents + screenshot]  →  Gemini Computer Use        │    │
│  │           model: gemini-2.5-computer-use-preview-10-2025         │    │
│  │                          ↓                                       │    │
│  │           FunctionCall(click_at | type_text | scroll | ...)      │    │
│  │                          ↓                                       │    │
│  │           → JSON actions returned to extension                   │    │
│  │           → session updated with response                        │    │
│  │           → done=True when structured JSON result found          │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│  POST /synthesize          gemini-2.5-flash  →  cross-cultural brief     │
│  POST /chat                gemini-2.5-flash  →  grounded Q&A             │
│                                                                           │
│  Infrastructure                                                           │
│  • min-instances = 1    prevents cold-start session loss                  │
│  • memory = 2Gi         headless Playwright + Chromium                    │
│  • GEMINI_API_KEY       via Google Secret Manager                         │
│  • Image stored in      Google Artifact Registry                          │
│  • CI/CD via            Google Cloud Build                                │
└───────────────────────────────────────────────────────────────────────────┘
```

### How the Browser Control Works

The key architectural distinction: **the browser runs in the user's real Chrome, not on a server.**

```
Chrome Extension (background.js)          Cloud Run (main.py)
─────────────────────────────────         ──────────────────────────────
chrome.windows.create({type:"popup"})
  → opens real Chrome window
chrome.debugger.attach(tabId)
  → connects Chrome DevTools Protocol
Page.setWebLifecycleState("active")
  → prevents background tab throttling

Loop (up to 30 turns):
  Page.captureScreenshot()
    → raw screenshot from live tab    ──▶  POST /computer-use-step
                                            Gemini Computer Use sees screenshot
                                            returns: { name: "click_at",
                                                       args: { x: 512, y: 340 } }
  execute action via CDP:            ◀──  { actions: [...], done: false }
    Input.dispatchMouseEvent(x, y)
    Input.insertText("query")
    Input.dispatchKeyEvent("Return")
    Page.navigate(url)
    ...

  when done=true:
    parse JSON result from Gemini
    chrome.runtime.sendMessage(RESULT)
    chrome.debugger.detach()
```

This means Textpot runs inside the user's authenticated browser session — no login flows, no bot detection, no headless fingerprinting. It uses whatever cookies and sessions the user already has.

### Agentic Loop

The Computer Use loop is a hand-rolled ReAct agent (Reason + Act):

```
Observe  →  Page.captureScreenshot() sends live browser state to Gemini
Reason   →  Gemini interprets the screenshot: where am I? what do I see?
                                               what should I do next?
Act      →  Gemini emits a FunctionCall (click, type, scroll, go_back...)
             Extension executes it via Chrome DevTools Protocol
Loop     →  Repeat until Gemini returns structured JSON result (done=true)
```

Each source runs its own independent agentic loop. All loops run concurrently — up to 6 parallel agents, one per platform.

### Request Flow

```
User types query
      │
      ▼
background.js launches 6 parallel Computer Use agents
      │
      ├──▶  Reddit      →  popup window + CDP + Gemini loop
      ├──▶  Threads     →  popup window + CDP + Gemini loop
      ├──▶  X           →  popup window + CDP + Gemini loop
      ├──▶  YouTube     →  popup window + CDP + Gemini loop
      ├──▶  Instagram   →  popup window + CDP + Gemini loop
      └──▶  TikTok      →  popup window + CDP + Gemini loop
                 │
                 ▼  (each source streams result as it completes)
      chrome.runtime.sendMessage → dashboard updates live
                 │
                 ▼  (after all sources finish)
      POST /synthesize → AI cross-platform analysis
                 │
                 ▼
      Signals Overview · Divergence Callout · Source Cards · Chat
```

---

## Why This Is Hard (And How We Solved It)

| Challenge | Solution |
|---|---|
| Social platforms block headless/server browsers | Run in the **user's real Chrome** via `chrome.debugger` (CDP) — existing auth sessions, real fingerprint, indistinguishable from human browsing |
| Background tabs freeze → stale screenshots | `chrome.windows.create({type:"popup"})` + `Page.setWebLifecycleState({state:"active"})` via CDP keeps tabs rendering |
| Gemini SDK types can't be JSON-serialized across HTTP | Server-side `_cu_sessions{}` stores live `Content` + `FunctionCall` objects in memory |
| Login walls, modals, CAPTCHAs | Task prompt instructs Gemini to dismiss overlays; drag-and-drop support for slider CAPTCHAs |
| One source failure cascading | `asyncio.gather(return_exceptions=True)` — failures are isolated |
| Screenshot timeouts hanging the loop | Fallback 1×1 PNG on timeout — loop continues gracefully |
| Cloud Run scaling breaking sessions | `min-instances=1` keeps session store warm |

---

## Supported Sources

| # | Platform | Content |
|---|---|---|
| 1 | Reddit | High-engagement discussions, comment threads |
| 2 | Threads | Social posts and replies |
| 3 | X (Twitter) | Tweets and quote tweets |
| 4 | YouTube | Video comments |
| 5 | Instagram | Post captions and comments |
| 6 | TikTok | Short-form video comments |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Chrome Extension | Manifest V3, Service Worker, Chrome Debugger Protocol (CDP) |
| AI — Browser Automation | **Gemini Computer Use** `gemini-2.5-computer-use-preview-10-2025` |
| AI — Text Tasks | **Gemini 2.5 Flash** (translate, synthesize, chat) |
| Backend | Python 3.11, FastAPI, Uvicorn |
| Cloud Runtime | **Google Cloud Run** (min-instances=1, 2Gi memory) |
| Container Registry | Google Artifact Registry |
| Secrets | Google Secret Manager |
| CI/CD | Google Cloud Build |
| Landing Page | Next.js → Vercel (`textpot.vercel.app`) |

---

## Project Structure

```
textpot/
├── extension/                  # Chrome Extension (MV3)
│   ├── manifest.json           # Permissions, host_permissions, service worker
│   ├── background.js           # Computer Use loop via chrome.debugger (CDP)
│   ├── dashboard.html          # Results UI layout + styles
│   ├── dashboard.js            # Sentiment overview, cards, divergence, chat
│   ├── popup.html / popup.js   # Toolbar popup → opens dashboard
│   ├── content.js              # Content scripts
│   └── icons/                  # Platform logos + extension icon
│
├── backend/                    # FastAPI — Google Cloud Run
│   ├── main.py                 # Endpoints + in-memory session store
│   ├── translate.py            # Query translation (Gemini Flash)
│   ├── synthesize.py           # Cross-platform AI brief (Gemini Flash)
│   ├── chat.py                 # Grounded follow-up Q&A (Gemini Flash)
│   └── requirements.txt
│
├── frontend/                   # Landing page — Vercel
│   └── app/page.tsx            # textpot.vercel.app
│
├── Dockerfile
└── cloudbuild.yaml
```

---

## Setup

### Chrome Extension

1. Clone the repo
2. `chrome://extensions` → Enable **Developer Mode** → **Load unpacked** → select `extension/`
3. Click the Textpot icon in the toolbar → **Open Textpot**

The extension points to the hosted Cloud Run backend — no local server needed.

### Backend — Local Development

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

export GEMINI_API_KEY=your_key_here
uvicorn main:app --reload --port 8080
```

Then update `BACKEND_URL` in `extension/background.js` and `extension/dashboard.js` to `http://localhost:8080`.

### Deploy Backend to Cloud Run

```bash
# Store API key in Secret Manager (one-time)
echo -n "your_api_key" | gcloud secrets create GEMINI_API_KEY --data-file=-

# Deploy via Cloud Build
gcloud builds submit --config cloudbuild.yaml
```

---

## Hackathon Notes — UI Navigator Track

**Track:** UI Navigator — Visual UI Understanding & Interaction

> *Build an agent that becomes the user's hands on screen. The agent observes the browser or device display, interprets visual elements with or without relying on APIs or DOM access, and performs actions based on user intent.*

### Mandatory Requirements

| Requirement | How Textpot satisfies it |
|---|---|
| **Gemini multimodal interprets screenshots** | Every Computer Use turn sends a live `Page.captureScreenshot()` to Gemini — the model sees the raw pixels and decides what to do next. Zero DOM access, zero selectors. |
| **Outputs executable actions** | Gemini returns structured `FunctionCall` objects (`click_at`, `type_text`, `scroll`, `go_back`, `key_combo`) that the extension executes directly via Chrome DevTools Protocol. |
| **Agents hosted on Google Cloud** | FastAPI backend runs on **Google Cloud Run** (min-instances=1, 2Gi memory). Image stored in **Google Artifact Registry**, deployed via **Google Cloud Build**. |

### Why It Fits the Track

| Criterion | Textpot |
|---|---|
| Universal web navigator | Navigates Reddit, TikTok, X, YouTube, Instagram, and Threads — platforms that block any API or headless approach — purely by reading the screen |
| Visual understanding without DOM | Task prompts contain no CSS selectors, XPaths, or element IDs. Gemini identifies buttons, links, and comment sections visually, the same way a human would |
| Cross-application automation | 6 parallel agents run simultaneously, each navigating a different platform with its own layout, language, and interaction pattern |
| User intent → screen actions | User types a plain-language query → agents autonomously navigate, scroll, click into posts, read comments, and return synthesized intelligence |
| Real authenticated browser | Runs in the user's own Chrome via `chrome.debugger` (CDP) — Gemini navigates the user's actual logged-in sessions, not a sandboxed headless instance |

### Google Cloud Services Used

| Service | Role |
|---|---|
| **Google Cloud Run** | Hosts the FastAPI backend; `min-instances=1` keeps the in-memory session store warm across multi-turn Computer Use loops |
| **Google Secret Manager** | Stores `GEMINI_API_KEY` — never in code or build logs |
| **Google Artifact Registry** | Stores the Docker image |
| **Google Cloud Build** | CI/CD pipeline — build → push → deploy on every `gcloud builds submit` |

---

## License

Apache 2.0
