# Textpot

**Social media sentiment intelligence — across every market, every language.**

Textpot is a Chrome extension powered by Gemini Computer Use that autonomously browses 11 global platforms in parallel — Reddit, TikTok, X, Threads, Naver, Baidu, and more — extracting authentic public sentiment and synthesizing it into a cross-cultural intelligence dashboard.

> Built for the Google Cloud × Gemini Hackathon

---

## What It Does

Type a query. Select your sources. Textpot opens real browser sessions, navigates each platform natively in the user's own Chrome, reads comments and discussions, and returns:

- **Per-platform sentiment breakdown** — positive / neutral / negative %
- **Representative quotes** from real users, translated to English
- **AI synthesis** — cross-cultural patterns and key takeaways
- **Divergence detection** — flags when markets significantly disagree
- **Follow-up chat** grounded in the collected results

No scraping APIs. No third-party data. Gemini sees the screen and acts like a human.

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

### Request Flow

```
User types query
      │
      ▼
background.js translates into N languages in parallel
      │
      ├──▶ 🇰🇷 Naver        Korean query
      ├──▶ 🇯🇵 Yahoo Japan  Japanese query       Each source:
      ├──▶ 🇨🇳 Baidu        Chinese query    →   1. Popup window (avoids tab throttling)
      ├──▶ 🇹🇼 Dcard        Chinese query        2. Attach Chrome Debugger (CDP)
      ├──▶ 🇨🇿 Seznam       Czech query          3. Navigate to results URL
      ├──▶    Reddit        English query        4. Loop: screenshot → Gemini → action
      ├──▶    Threads       English query        5. Extract structured JSON result
      ├──▶    X (Twitter)   English query
      ├──▶    YouTube       English query
      ├──▶    Instagram     English query
      └──▶    TikTok        English query
                 │
                 ▼  (each source streams results as it completes)
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
| Platforms block headless browsers | Run in the **user's real Chrome** via `chrome.debugger` — full auth sessions, real fingerprint, no bot detection |
| Background tabs freeze → stale screenshots | `chrome.windows.create({type:"popup"})` + `Page.setWebLifecycleState({state:"active"})` via CDP |
| Gemini SDK types can't be JSON-serialized across HTTP | Server-side `_cu_sessions{}` stores live `Content` + `FunctionCall` objects in memory |
| Multilingual search accuracy | Query translated to native language before URL construction; per-source locale + Accept-Language headers |
| Login walls, modals, CAPTCHAs | Task prompt instructs Gemini to dismiss overlays; drag-and-drop support for slider CAPTCHAs |
| One source failure cascading | `asyncio.gather(return_exceptions=True)` — failures are isolated |
| Screenshot timeouts hanging the loop | Fallback 1×1 PNG on timeout — loop continues gracefully |
| Cloud Run scaling breaking sessions | `min-instances=1` keeps session store warm |

---

## Supported Sources

| # | Platform | Region | Language | Content Type |
|---|---|---|---|---|
| 1 | 🇰🇷 Naver | Korea | Korean | Blog posts, opinions |
| 2 | 🇯🇵 Yahoo Japan | Japan | Japanese | News, mainstream coverage |
| 3 | 🇨🇳 Baidu | China | Simplified Chinese | Web search |
| 4 | 🇹🇼 Dcard | Taiwan | Traditional Chinese | Forum discussions |
| 5 | 🇨🇿 Seznam | Czech Republic | Czech | Local search |
| 6 | Reddit | Global | English | High-engagement discussions |
| 7 | Threads | Global | English | Social posts |
| 8 | X (Twitter) | Global | English | Tweets + replies |
| 9 | YouTube | Global | English | Video comments |
| 10 | Instagram | Global | English | Visual posts |
| 11 | TikTok | Global | English | Short-form video comments |

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
│   ├── agent.py                # Parallel agent orchestration
│   ├── computer_use.py         # Playwright-based Computer Use loop
│   ├── sources.py              # Source configs + shared task prompt
│   ├── translate.py            # Parallel query translation
│   ├── synthesize.py           # Cross-platform AI brief
│   ├── chat.py                 # Grounded follow-up Q&A
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

## Hackathon Notes

| Requirement | Status |
|---|---|
| `google-genai` Python SDK | ✅ |
| Gemini Computer Use (`gemini-2.5-computer-use-preview-10-2025`) | ✅ |
| Gemini multimodal — screenshots as input | ✅ |
| Google Cloud service (Cloud Run) | ✅ |
| Google Secret Manager | ✅ |
| Google Artifact Registry + Cloud Build | ✅ |
| Parallel multi-agent execution | ✅ (`asyncio.gather` across 11 sources) |
| No hardcoded DOM selectors — pure vision | ✅ |
| Runs in user's authenticated browser | ✅ (unique to this approach) |

---

## License

Apache 2.0
