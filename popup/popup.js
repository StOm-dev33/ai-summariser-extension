/**
 * Nexus AI Summarizer — Popup Script
 * Orchestrates content extraction, AI summarization, and UI rendering.
 * No API keys — all sensitive calls are delegated to the service worker.
 */

"use strict";

// ── DOM References ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const elPageTitle     = $("page-title");
const elStateIdle     = $("state-idle");
const elStateLoading  = $("state-loading");
const elStateError    = $("state-error");
const elStateResult   = $("state-result");
const elErrorMessage  = $("error-message");
const elSummaryList   = $("summary-list");
const elInsightsList  = $("insights-list");
const elReadingTime   = $("reading-time-text");
const elWordCount     = $("word-count-text");
const elMetaCache     = $("meta-cache");
const elLoadingTitle  = $("loading-title");
const elLoadingSub    = $("loading-sub");
const elToast         = $("toast");

const btnSummarize = $("btn-summarize");
const btnRetry     = $("btn-retry");
const btnCopy      = $("btn-copy");
const btnHighlight = $("btn-highlight");
const btnClear     = $("btn-clear");
const btnTheme     = $("themeToggle");

// ── App State ─────────────────────────────────────────────────────────────────
let currentTab      = null;
let currentSummary  = null;
let highlightActive = false;
let toastTimer      = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (tab?.title) {
      elPageTitle.textContent = tab.title;
    } else {
      elPageTitle.textContent = "Unknown page";
    }

    // Set favicon
    if (tab?.favIconUrl) {
      const favicon = document.getElementById("page-favicon");
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      img.width = 14;
      img.height = 14;
      img.style.borderRadius = "3px";
      img.onerror = () => {}; // Silently fail
      favicon.innerHTML = "";
      favicon.appendChild(img);
    }

    // Load theme preference
    await loadTheme();

    // Check if we have a cached summary already
    await checkCache();
  } catch (err) {
    elPageTitle.textContent = "Could not read page";
    console.warn("[Nexus Popup] Init error:", err.message);
  }
}

async function checkCache() {
  if (!currentTab?.url) return;

  // Ask service worker if cache exists
  const cacheKey = buildCacheKey(currentTab.url);
  const result   = await chrome.storage.local.get(cacheKey);
  const entry    = result[cacheKey];

  if (entry && Date.now() - entry.timestamp < 1000 * 60 * 30) {
    renderResult(entry.data, true);
  }
}

function buildCacheKey(url) {
  try {
    const u = new URL(url);
    return `cache::${u.origin}${u.pathname}`;
  } catch {
    return `cache::${url}`;
  }
}

// ── Theme Management ──────────────────────────────────────────────────────────
async function loadTheme() {
  const result = await chrome.storage.sync.get({ theme: "dark" });
  const theme = result.theme;
  
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

async function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "light" ? "dark" : "light";
  
  document.documentElement.setAttribute("data-theme", newTheme);
  await chrome.storage.sync.set({ theme: newTheme });
}

// ── Loading Steps ─────────────────────────────────────────────────────────────
let loadingStepTimer = null;

function startLoadingSteps() {
  const steps = [
    { id: "step-1", label: "Extracting content…",    sub: "Reading the page" },
    { id: "step-2", label: "Sending to AI…",          sub: "Connecting to server" },
    { id: "step-3", label: "Generating summary…",     sub: "Almost there" },
  ];

  let current = 0;

  function activate(i) {
    steps.forEach((s, idx) => {
      const el = $(s.id);
      el.removeAttribute("data-active");
      el.removeAttribute("data-done");
      if (idx < i) el.setAttribute("data-done", "true");
      if (idx === i) el.setAttribute("data-active", "true");
    });
    elLoadingTitle.textContent = steps[i].label;
    elLoadingSub.textContent   = steps[i].sub;
  }

  activate(0);
  loadingStepTimer = setInterval(() => {
    current = Math.min(current + 1, steps.length - 1);
    activate(current);
  }, 2200);
}

function stopLoadingSteps() {
  if (loadingStepTimer) {
    clearInterval(loadingStepTimer);
    loadingStepTimer = null;
  }
  // Mark all done
  ["step-1","step-2","step-3"].forEach((id) => {
    const el = $(id);
    el.removeAttribute("data-active");
    el.setAttribute("data-done", "true");
  });
}

// ── State Transitions ─────────────────────────────────────────────────────────
function showState(name) {
  [elStateIdle, elStateLoading, elStateError, elStateResult].forEach((el) =>
    el.classList.add("hidden")
  );
  const map = {
    idle:    elStateIdle,
    loading: elStateLoading,
    error:   elStateError,
    result:  elStateResult,
  };
  map[name]?.classList.remove("hidden");

  // Toggle action buttons
  const inResult = name === "result";
  [btnCopy, btnHighlight, btnClear].forEach((btn) => {
    if (inResult) {
      btn.classList.add("visible");
    } else {
      btn.classList.remove("visible");
    }
  });

  btnSummarize.disabled = name === "loading";
}

// ── Summarize Flow ────────────────────────────────────────────────────────────
async function summarize() {
  if (!currentTab?.id) {
    showError("No active tab found. Please try again.");
    return;
  }

  showState("loading");
  startLoadingSteps();

  try {
    // Step 1: Extract content from page
    let extractResult;
    try {
      extractResult = await chrome.tabs.sendMessage(currentTab.id, {
        action: "EXTRACT_CONTENT",
      });
    } catch (err) {
      // Content script may not have loaded — inject it
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["content/content-script.js"],
      });
      extractResult = await chrome.tabs.sendMessage(currentTab.id, {
        action: "EXTRACT_CONTENT",
      });
    }

    if (!extractResult?.success) {
      throw new Error(extractResult?.error || "Failed to extract page content.");
    }

    const { content, wordCount, readingTimeMin } = extractResult.data;

    if (!content || content.trim().length < 80) {
      throw new Error(
        "This page doesn't have enough readable text to summarize."
      );
    }

    // Step 2: Send to service worker → proxy server → AI
    const summaryResult = await chrome.runtime.sendMessage({
      action: "SUMMARIZE",
      payload: {
        url:     currentTab.url,
        title:   currentTab.title || "",
        content,
        wordCount,
      },
    });

    stopLoadingSteps();

    if (!summaryResult?.success) {
      throw new Error(summaryResult?.error || "Failed to generate summary.");
    }

    const fromCache = summaryResult.data?.fromCache || false;
    renderResult(summaryResult.data, fromCache);
  } catch (err) {
    stopLoadingSteps();
    showError(err.message);
  }
}

// ── Render Result ─────────────────────────────────────────────────────────────
function renderResult(data, fromCache = false) {
  currentSummary = data;

  // Meta
  elReadingTime.textContent = `${data.readingTime ?? "—"}`;
  elWordCount.textContent   = `${(data.wordCount ?? 0).toLocaleString()} words`;

  if (fromCache) {
    elMetaCache.classList.remove("hidden");
  } else {
    elMetaCache.classList.add("hidden");
  }

  // Summary bullets
  elSummaryList.innerHTML = "";
  const summaryItems = Array.isArray(data.summary) ? data.summary : [];
  summaryItems.forEach((text) => {
    const li = document.createElement("li");
    li.className = "summary-item";
    li.innerHTML = `
      <span class="summary-bullet" aria-hidden="true"></span>
      <span>${sanitizeHTML(text)}</span>
    `;
    elSummaryList.appendChild(li);
  });

  // Insights
  elInsightsList.innerHTML = "";
  const insights = Array.isArray(data.keyInsights) ? data.keyInsights : [];
  const icons = ["💡", "🔍", "📌", "⚡", "🎯"];
  insights.forEach((text, i) => {
    const li = document.createElement("li");
    li.className = "insight-item";
    li.innerHTML = `
      <span class="insight-icon" aria-hidden="true">${icons[i % icons.length]}</span>
      <span>${sanitizeHTML(text)}</span>
    `;
    elInsightsList.appendChild(li);
  });

  showState("result");
}

function showError(message) {
  elErrorMessage.textContent = message || "Something went wrong. Please try again.";
  showState("error");
}

// ── Sanitize HTML (prevent XSS) ───────────────────────────────────────────────
function sanitizeHTML(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Copy Summary ──────────────────────────────────────────────────────────────
async function copySummary() {
  if (!currentSummary) return;

  const lines = [
    `📄 ${currentTab?.title || "Page Summary"}`,
    `⏱ ${currentSummary.readingTimeMin} min read · ${(currentSummary.wordCount || 0).toLocaleString()} words`,
    "",
    "Summary:",
    ...(currentSummary.summary || []).map((s) => `• ${s}`),
    "",
    "Key Insights:",
    ...(currentSummary.insights || []).map((s) => `• ${s}`),
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("Summary copied!", "success");
  } catch {
    showToast("Failed to copy.", "error");
  }
}

// ── Highlight Toggle ──────────────────────────────────────────────────────────
async function toggleHighlight() {
  if (!currentTab?.id || !currentSummary) return;

  highlightActive = !highlightActive;
  btnHighlight.classList.toggle("active", highlightActive);

  if (highlightActive) {
    // Extract keywords from insights
    const keywords = extractKeywords(currentSummary);
    await chrome.tabs.sendMessage(currentTab.id, {
      action: "HIGHLIGHT_KEYWORDS",
      keywords,
    }).catch(() => {});
    showToast("Key terms highlighted", "success");
  } else {
    await chrome.tabs.sendMessage(currentTab.id, {
      action: "CLEAR_HIGHLIGHTS",
    }).catch(() => {});
    showToast("Highlights cleared", "success");
  }
}

function extractKeywords(data) {
  const text = [
    ...(data.summary || []),
    ...(data.insights || []),
  ].join(" ");

  // Simple keyword extraction: words > 5 chars, deduplicated
  const stopwords = new Set([
    "about","above","after","again","also","another","article",
    "because","before","being","between","every","first","found",
    "however","important","including","information","instead","likely",
    "makes","might","often","other","people","provide","should","shows",
    "since","some","still","such","their","there","these","thing",
    "though","through","under","using","various","which","while","within",
  ]);

  const words = text
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 5 && !stopwords.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());

  return [...new Set(words)].slice(0, 12);
}

// ── Clear ─────────────────────────────────────────────────────────────────────
async function clearSummary() {
  // Clear highlights if active
  if (highlightActive && currentTab?.id) {
    await chrome.tabs.sendMessage(currentTab.id, {
      action: "CLEAR_HIGHLIGHTS",
    }).catch(() => {});
    highlightActive = false;
  }

  // Clear cache for this URL
  if (currentTab?.url) {
    await chrome.runtime.sendMessage({
      action: "CLEAR_CACHE",
      url: currentTab.url,
    });
  }

  currentSummary = null;
  showState("idle");
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = "default") {
  if (toastTimer) clearTimeout(toastTimer);

  elToast.textContent = message;
  elToast.className = `toast toast-${type} visible`;

  toastTimer = setTimeout(() => {
    elToast.classList.remove("visible");
  }, 2200);
}

// ── Event Listeners ───────────────────────────────────────────────────────────
btnSummarize.addEventListener("click", summarize);
btnRetry.addEventListener("click", summarize);
btnCopy.addEventListener("click", copySummary);
btnHighlight.addEventListener("click", toggleHighlight);
btnClear.addEventListener("click", clearSummary);
btnTheme.addEventListener("click", toggleTheme);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !btnSummarize.disabled) summarize();
  if (e.key === "Escape") clearSummary();
});