import { CONFIG } from "./config.js";

const CACHE_EXPIRY_MS = 30 * 60 * 1000;

// Keep service worker alive during long API calls
function keepAlive() {
  const interval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
  return interval;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "SUMMARIZE") return false;

  if (!validateMessage(message)) {
    sendResponse({ success: false, error: "Invalid message format." });
    return false;
  }

  const aliveInterval = keepAlive();

  handleSummarize(message.payload)
    .then((result) => {
      clearInterval(aliveInterval);
      sendResponse({ success: true, data: result });
    })
    .catch((err) => {
      clearInterval(aliveInterval);
      sendResponse({ success: false, error: err.message || "Unknown error." });
    });

  return true;
});

function validateMessage(message) {
  return (
    message.action === "SUMMARIZE" &&
    message.payload &&
    typeof message.payload.content === "string" &&
    typeof message.payload.url === "string" &&
    typeof message.payload.title === "string"
  );
}

async function handleSummarize(payload) {
  const { content, url, title } = payload;

  const cached = await getCached(url);
  if (cached) return { ...cached, fromCache: true };

  const trimmedContent = content.slice(0, CONFIG.MAX_CONTENT_LENGTH);
  const summary = await callGroqAPI(title, trimmedContent);

  await setCached(url, summary);
  return { ...summary, fromCache: false };
}

async function callGroqAPI(title, content) {
  const prompt = buildPrompt(title, content);

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      messages: [
        {
          role: "system",
          content: "You are a webpage summarizer. Always respond with valid JSON only. No markdown, no backticks, no explanation."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: CONFIG.MAX_TOKENS,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `API error: ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || "";

  if (!raw) throw new Error("Empty response from AI. Please try again.");

  return parseStructuredResponse(raw, content);
}

function buildPrompt(title, content) {
  return `Summarize this webpage content. Return ONLY a JSON object, nothing else.

Page Title: "${title}"

Content:
${content}

Return this exact JSON:
{
  "summary": ["point 1", "point 2", "point 3"],
  "keyInsights": ["insight 1", "insight 2"],
  "readingTime": "X min read",
  "wordCount": 123,
  "topic": "topic label"
}`;
}

function parseStructuredResponse(raw, originalContent) {
  try {
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const parsed = JSON.parse(jsonMatch[0]);

    const summary = Array.isArray(parsed.summary) && parsed.summary.length > 0
      ? parsed.summary.map(sanitizeText).filter(Boolean).slice(0, 5)
      : ["Summary unavailable."];

    const keyInsights = Array.isArray(parsed.keyInsights)
      ? parsed.keyInsights.map(sanitizeText).filter(Boolean).slice(0, 3)
      : [];

    return {
      summary,
      keyInsights,
      readingTime: typeof parsed.readingTime === "string"
        ? sanitizeText(parsed.readingTime)
        : estimateReadingTime(originalContent),
      wordCount: typeof parsed.wordCount === "number"
        ? parsed.wordCount
        : countWords(originalContent),
      topic: typeof parsed.topic === "string"
        ? sanitizeText(parsed.topic)
        : "General",
      fromCache: false
    };
  } catch (e) {
    return {
      summary: ["Could not parse summary. Please try again."],
      keyInsights: [],
      readingTime: estimateReadingTime(originalContent),
      wordCount: countWords(originalContent),
      topic: "General",
      fromCache: false
    };
  }
}

function sanitizeText(str) {
  return String(str)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .trim();
}

function estimateReadingTime(text) {
  const words = countWords(text);
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function getCached(url) {
  return new Promise((resolve) => {
    const key = `cache_${btoa(url).slice(0, 50)}`;
    chrome.storage.local.get([key], (result) => {
      const entry = result[key];
      if (!entry) return resolve(null);
      if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
        chrome.storage.local.remove([key]);
        return resolve(null);
      }
      resolve(entry.data);
    });
  });
}

async function setCached(url, data) {
  return new Promise((resolve) => {
    const key = `cache_${btoa(url).slice(0, 50)}`;
    chrome.storage.local.set({ [key]: { data, timestamp: Date.now() } }, resolve);
  });
}
