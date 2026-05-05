/**
 * Nexus AI Summarizer — Content Script
 * Extracts readable content from the page and handles in-page highlights.
 * Runs in the page context — no API keys, no external calls.
 */

(function () {
  "use strict";

  // Prevent double-injection
  if (window.__nexusSummarizerInjected) return;
  window.__nexusSummarizerInjected = true;

  // ── Message Listener ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== "string") return false;

    switch (message.action) {
      case "EXTRACT_CONTENT":
        try {
          const result = extractContent();
          sendResponse({ success: true, data: result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return false;

      case "HIGHLIGHT_KEYWORDS":
        try {
          highlightKeywords(message.keywords || []);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return false;

      case "CLEAR_HIGHLIGHTS":
        clearHighlights();
        sendResponse({ success: true });
        return false;
    }

    return false;
  });

  // ── Content Extraction ───────────────────────────────────────────────────────
  function extractContent() {
    const title = document.title || "";
    const url = window.location.href;

    // Priority-ordered content selectors
    const contentSelectors = [
      "article",
      '[role="main"]',
      "main",
      ".post-content",
      ".article-content",
      ".article-body",
      ".entry-content",
      ".content-body",
      ".story-body",
      ".post-body",
      "#content",
      "#main-content",
      ".main-content",
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && getTextLength(el) > 200) {
        contentEl = el;
        break;
      }
    }

    // Fallback to body
    if (!contentEl) contentEl = document.body;

    // Clone and strip noise
    const clone = contentEl.cloneNode(true);
    stripNoise(clone);

    // Extract clean text
    const rawText = extractText(clone);
    const cleaned = cleanText(rawText);
    const wordCount = countWords(cleaned);

    return {
      title: sanitizeText(title),
      content: cleaned,
      wordCount,
      url,
      readingTimeMin: Math.max(1, Math.ceil(wordCount / 200)),
    };
  }

  // Strip navigation, ads, scripts, styles, etc.
  function stripNoise(el) {
    const noiseSelectors = [
      "nav", "header", "footer", "aside",
      ".nav", ".navbar", ".navigation", ".menu",
      ".sidebar", ".side-bar", ".widget",
      ".advertisement", ".ads", ".ad", "[class*='banner']",
      ".cookie", ".popup", ".modal", ".overlay",
      ".comments", ".comment-section", "#comments",
      ".social-share", ".share-buttons",
      ".related-posts", ".recommended",
      "script", "style", "noscript", "iframe",
      "button", "form", '[role="banner"]',
      '[role="navigation"]', '[role="complementary"]',
      '[role="contentinfo"]',
    ];

    noiseSelectors.forEach((sel) => {
      el.querySelectorAll(sel).forEach((node) => node.remove());
    });

    // Remove hidden elements
    el.querySelectorAll("*").forEach((node) => {
      const style = window.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        node.remove();
      }
    });
  }

  function extractText(el) {
    const blockElements = new Set([
      "P", "H1", "H2", "H3", "H4", "H5", "H6",
      "LI", "TD", "TH", "BLOCKQUOTE", "PRE", "DIV", "SECTION",
    ]);

    let text = "";

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const isBlock = blockElements.has(node.tagName);
      if (isBlock && text.length && !text.endsWith("\n")) text += "\n";

      for (const child of node.childNodes) walk(child);

      if (isBlock && text.length && !text.endsWith("\n")) text += "\n";
    }

    walk(el);
    return text;
  }

  function cleanText(text) {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ ]{2,}/g, " ")           // collapse multiple spaces
      .replace(/\n{3,}/g, "\n\n")          // max 2 consecutive newlines
      .replace(/^\s+|\s+$/gm, "")          // trim each line
      .trim()
      .slice(0, 12000);                    // limit to ~12k chars for API
  }

  function getTextLength(el) {
    return (el.textContent || "").trim().length;
  }

  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  function sanitizeText(text) {
    return text.replace(/[<>&"']/g, (c) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
    }[c] || c));
  }

  // ── In-Page Highlighting ─────────────────────────────────────────────────────
  const HIGHLIGHT_CLASS = "nexus-highlight";
  const HIGHLIGHT_STYLE_ID = "nexus-highlight-styles";

  function highlightKeywords(keywords) {
    // Inject highlight styles
    if (!document.getElementById(HIGHLIGHT_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = `
        .${HIGHLIGHT_CLASS} {
          background: linear-gradient(120deg, rgba(99,102,241,0.35) 0%, rgba(129,140,248,0.25) 100%);
          border-radius: 3px;
          padding: 1px 2px;
          box-shadow: 0 0 0 1px rgba(99,102,241,0.4);
          transition: all 0.2s ease;
        }
        .${HIGHLIGHT_CLASS}:hover {
          background: linear-gradient(120deg, rgba(99,102,241,0.55) 0%, rgba(129,140,248,0.45) 100%);
        }
      `;
      document.head.appendChild(style);
    }

    if (!keywords.length) return;

    // Sanitize keywords before use
    const safeKeywords = keywords
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .filter((k) => k.length > 3)
      .slice(0, 10);

    if (!safeKeywords.length) return;

    const pattern = new RegExp(`\\b(${safeKeywords.join("|")})\\b`, "gi");

    // Walk text nodes in main content only
    const contentArea =
      document.querySelector("article, main, [role='main']") || document.body;

    walkTextNodes(contentArea, (textNode) => {
      const parent = textNode.parentNode;
      if (!parent || parent.classList?.contains(HIGHLIGHT_CLASS)) return;
      if (["SCRIPT", "STYLE", "INPUT", "TEXTAREA"].includes(parent.tagName)) return;

      const text = textNode.textContent;
      if (!pattern.test(text)) return;
      pattern.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        // Text before match
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index))
          );
        }
        // Highlighted match — sanitize content
        const mark = document.createElement("mark");
        mark.className = HIGHLIGHT_CLASS;
        mark.textContent = match[0]; // textContent is safe — no HTML injection
        fragment.appendChild(mark);
        lastIndex = pattern.lastIndex;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      parent.replaceChild(fragment, textNode);
    });
  }

  function clearHighlights() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function walkTextNodes(root, callback) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent.trim().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(callback);
  }
})();