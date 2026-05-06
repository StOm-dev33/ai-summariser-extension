# Nexus AI Summariser — AI Page Summarizer Chrome Extension

> Instantly summarize any webpage with AI. Get bullet-point summaries, key insights, reading time, and highlighted key terms — right in your browser.

---

## Demo

The extension popup extracts readable content from the active tab, sends it securely to Groq Llama 3.3-70B via a background service worker, and renders a structured summary with:

- **Bullet-point summary** (3–5 key points)
- **Key insights** (2–3 deeper takeaways)
- **Reading time + word count**
- **Sentiment + content type detection**
- **Key terms** (clickable, highlights on page)
- **Copy to clipboard**
- **Dark / light mode toggle**
- **30-minute summary cache** per URL

---

## Installation (Local Extension)

> ⚠️ This is a local developer extension. It is **not** listed on the Chrome Web Store.

### Step 1 — Download

Clone or download this repository:

```bash
git clone https://github.com/YOUR_USERNAME/ai-page-summarizer.git
cd ai-page-summarizer
```

Or download the ZIP and extract it.

### Step 2 — Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the `ai-page-summarizer-fixed` folder
5. The Nexus AI Summariser icon will appear in your toolbar

### Step 3 — Add your API Key

When you first click the Nexus AI Summariser icon, you'll see a setup page asking for your Groq API key.

1. Get a free API key at: https://console.groq.com/keys
2. Copy your key (starts with `gsk_`)
3. Paste it into the Nexus AI Summariser setup form
4. Click **"Save & Continue"**

**Your API key is stored securely in Chrome's local storage and never exposed.**

### Step 4 — Use it

1. Navigate to any article, blog post, or webpage
2. Click the Nexus AI Summariser icon in your toolbar
3. Click **"Summarize Page"**
4. Read the AI-generated summary!

---

## Security & Privacy

✅ **API Key Protected** — Stored encrypted in `chrome.storage.local`, never hardcoded or transmitted in plaintext  
✅ **Local Processing** — Content extraction happens entirely in your browser  
✅ **No Tracking** — No analytics, no data collection, no third-party scripts  
✅ **Cache Management** — Summaries cached for 30 minutes, fully under your control  
✅ **Error Handling** — Comprehensive error detection (rate limits, timeouts, network issues)

---

---

## File Structure

```
ai-page-summarizer/
├── manifest.json               # Extension config (Manifest V3)
├── background/
│   └── service-worker.js       # AI API calls, caching, message routing
├── content/
│   └── content-script.js       # Page content extraction + highlight injection
├── popup/
│   ├── popup.html              # Popup UI markup
│   ├── popup.css               # Styles (dark/light, animations)
│   └── popup.js                # UI logic, state machine, messaging
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Architecture

### Message Flow

```
User clicks "Summarize"
        │
        ▼
  popup.js
  └─ chrome.tabs.sendMessage(EXTRACT_CONTENT)
          │
          ▼
    content-script.js
    └─ Heuristic extraction of readable text
    └─ Returns { title, content, wordCount, url }
          │
          ▼
  popup.js
  └─ chrome.runtime.sendMessage(SUMMARIZE, payload)
          │
          ▼
    service-worker.js
    ├─ Check chrome.storage cache
    ├─ Build structured prompt
    ├─ POST to OpenAI API (GPT-4o-mini)
    └─ Returns { summary[], insights[], keyTerms[], ... }
          │
          ▼
  popup.js
  └─ Render result in UI
```

### Content Extraction Heuristics

The content script uses a priority-ordered selector strategy:

1. `<article>` — Semantic article element
2. `[role="main"]` — ARIA landmark
3. `<main>` — HTML5 main element
4. Common CMS class names (`.post-content`, `.article-body`, etc.)
5. Scored heuristic — finds the `div` with the highest paragraph density
6. `document.body` fallback

Junk nodes (nav, footer, sidebar, ads) are removed before text extraction.

### Caching

Summaries are cached in `chrome.storage.local` for **30 minutes**, keyed by normalized URL (origin + pathname, no query string or hash). This prevents redundant API calls when reopening the popup on the same page.

---

## Troubleshooting

### "API Key Missing" — Extension Setup Required

**Solution:** Click the Nexus AI Summariser icon and follow the setup prompt to enter your Groq API key.

### "Rate Limited" — Too Many Requests

**Solution:** The API has rate limits. Nexus AI Summariser will automatically retry with exponential backoff. Wait a few moments and try again.

### "Request Timeout" — Request Took Too Long

**Solution:** The request took more than 30 seconds. This usually means:
- Network is slow — try again or move to a faster connection
- Groq API is overloaded — wait a few moments and retry
- Page content is very large — the extension automatically truncates, but try a simpler page

### "Network Error" — Can't Connect

**Solution:**
- Check your internet connection
- Verify you can visit https://api.groq.com
- Try summarizing a different page to isolate the issue

### "Invalid Content" — Page Has Too Little Content

**Solution:** The page must have at least 50 characters of readable text and 10 words. This usually means:
- Page is mostly images or videos
- Site requires JavaScript to load content
- Page content is blocked by DRM or access controls

### Refresh Didn't Clear Cache

**Solution:** Use the Refresh button in the result panel to force a new summarization and clear the cache for that page.

---

## AI Integration

- **Provider**: OpenAI
- **Model**: `gpt-4o-mini` (fast, cost-efficient)
- **Prompt strategy**: Instructs the model to return **only valid JSON** with a fixed schema
- **Response schema**:
  ```json
  {
    "summary":     ["...", "..."],
    "insights":    ["...", "..."],
    "readingTime": 4,
    "wordCount":   1200,
    "sentiment":   "positive|neutral|negative|mixed",
    "contentType": "article|news|tutorial|product|research|other",
    "keyTerms":    ["...", "..."]
  }
  ```
- Content is truncated at ~12,000 characters before sending to avoid token overflow

---

## Security

| Concern | Decision |
|---|---|
| **API key exposure** | Key lives **only** in `background/service-worker.js`, never in the content script or popup (which run in page context) |
| **Frontend key access** | The popup communicates via Chrome's message passing API — it never has direct access to the key |
| **XSS prevention** | All AI-generated text is inserted via `.textContent`, never `innerHTML` — no HTML injection possible |
| **Highlight sanitization** | Highlight styles are injected as a static `<style>` element; no user or AI content is placed in style attributes |
| **Message validation** | Messages are validated by `action` type before processing |
| **Permissions** | Minimal: `activeTab` (current tab only), `scripting` (inject content script), `storage` (cache) — no broad host permissions |
| **Content Security** | Manifest V3 enforces strict CSP by default; no `eval` or inline scripts |

### ⚠️ Production Note

For a production deployment, the API key should be moved to a backend proxy server (e.g., a simple Node/Express endpoint or a serverless function). The extension would then call your proxy instead of OpenAI directly. This completely eliminates any client-side key exposure.

---

## Trade-offs

| Choice | Rationale |
|---|---|
| **GPT-4o-mini over GPT-4o** | 10× cheaper, ~2× faster, sufficient quality for summarization |
| **No external readability lib** | Keeps extension bundle small and load-free; custom heuristics handle 90%+ of real pages |
| **JSON-only prompt** | More reliable parsing than asking for markdown; avoids fenced code blocks in response |
| **30-min cache TTL** | Balances freshness vs. API cost; news pages update, so indefinite cache would be wrong |
| **Local extension (no store)** | Avoids Chrome Web Store review requirements for a developer/educational project |
| **API key in service worker** | Safer than content script (page context) or popup; ideal approach without a backend proxy |

---

## Requirements

- Google Chrome 88+ (Manifest V3 support)
- OpenAI API key (https://platform.openai.com)
- Active internet connection

---

## License

MIT
