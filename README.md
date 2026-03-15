# Textpot

**Search the world, not just your corner of it.**

Textpot is a multilingual research agent that uses Gemini's Computer Use tool to autonomously navigate foreign search engines (Naver, Yahoo Japan, Baidu, Weibo) in parallel — watching the browser in real time — and synthesizes findings into a structured research dashboard with a follow-up chat interface.

---

## Screenshots

> _Add screenshots here after deployment_

| Live Browser Lanes | Research Dashboard | AI Chat |
|---|---|---|
| ![lanes](docs/lanes.png) | ![dashboard](docs/dashboard.png) | ![chat](docs/chat.png) |

---

## Architecture

See [`architecture.html`](architecture.html) for the interactive architecture diagram.

```
User Browser (Vercel)
       │  WebSocket
       ▼
FastAPI Backend (Cloud Run)
       │
       ├── asyncio.gather ─────────────────────────────────────┐
       │                                                        │
       ├── [Naver Agent]     ├── [Yahoo Japan Agent]           │
       │   Playwright+Gemini │   Playwright+Gemini             │
       │                     │                                 │
       └── [Baidu Agent]     └── [Weibo Agent]                 │
           Playwright+Gemini     Playwright+Gemini             │
                                                               │
       ◄─── Screenshots stream to frontend ────────────────────┘
       ◄─── Results as each source completes ─────────────────┘
       ◄─── Synthesis (gemini-2.0-flash) ─────────────────────┘
```

---

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Google AI Studio API key

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium

# Set your API key
export GEMINI_API_KEY=your_key_here

uvicorn main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8080/ws
```

```bash
npm run dev
# Open http://localhost:3000
```

---

## Environment Variables

| Variable | Description | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key | [aistudio.google.com](https://aistudio.google.com) |
| `NEXT_PUBLIC_BACKEND_WS_URL` | WebSocket URL of the deployed backend | Cloud Run URL + `/ws` (use `wss://`) |

---

## Deploy Backend to Cloud Run

### One-time setup

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs (already enabled per setup notes)
gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com
```

### Deploy

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _GEMINI_API_KEY=your_api_key_here
```

After deployment, get your service URL:

```bash
gcloud run services describe textpot-backend \
  --region us-central1 \
  --format "value(status.url)"
```

Your WebSocket URL is: `wss://<that-url>/ws`

---

## Deploy Frontend to Vercel

1. Push this repository to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo
3. Set the **Root Directory** to `frontend`
4. Add environment variable:
   - `NEXT_PUBLIC_BACKEND_WS_URL` = `wss://your-cloud-run-url/ws`
5. Deploy

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | Python, FastAPI, uvicorn |
| AI (Computer Use) | `gemini-2.5-flash-preview` via `google-genai` SDK |
| AI (Synthesis & Chat) | `gemini-2.0-flash` via `google-genai` SDK |
| Browser Automation | Playwright (headless Chromium) |
| Cloud | Google Cloud Run |
| Frontend Hosting | Vercel |

---

## Hackathon Submission Notes

- **SDK**: `google-genai` Python SDK (`from google import genai`) ✅
- **Model**: `gemini-2.5-flash-preview` with Computer Use tool ✅
- **Google Cloud Service**: Cloud Run ✅
- **Category**: UI Navigator ✅
- **Multimodal**: Gemini interprets browser screenshots and emits executable actions (click, type, scroll, key press) — no hardcoded selectors ✅
- **Parallel execution**: All sources run simultaneously via `asyncio.gather` ✅

---

## License

MIT
