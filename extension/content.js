/**
 * Textpot content script — extracts comment text from a post/article page.
 *
 * Injected into individual post pages (not search results pages).
 * Tries per-site comment selectors first, then generic fallbacks.
 * Returns extracted comment text as a string.
 */
(() => {
  const MAX_CHARS = 12000;
  const seen = new Set();
  const chunks = [];

  function add(text) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t.length > 15 && !seen.has(t)) {
      seen.add(t);
      chunks.push(t);
    }
  }

  const host = location.hostname;

  const COMMENT_SELECTORS = {
    "www.reddit.com": [
      "shreddit-comment [slot='comment'] p",
      "[data-testid='comment'] p",
      ".Comment p",
      "[id^='t1_'] p",
      "shreddit-comment p",
    ],
    "blog.naver.com":  [".u_cbox_contents", ".comment_text_box"],
    "news.naver.com":  [".u_cbox_contents"],
    "cafe.naver.com":  [".comment_area .text"],
    "www.dcard.tw": [
      "[class*='Comment_content']",
      "[class*='commentContent']",
      "[class*='comment'] p",
    ],
    "www.threads.net": [
      "[data-pressable-container] div[dir='auto']",
      "article div[dir='auto']",
      "div[dir='auto']",
    ],
    "x.com": [
      "[data-testid='tweetText']",
      "article div[lang]",
      "[data-testid='tweet'] div[lang]",
    ],
    "news.yahoo.co.jp": [
      "[class*='comment'] p",
      "[data-ydl-sid] p",
      ".yjDirectSLinkTarget",
    ],
  };

  const siteSelectors = COMMENT_SELECTORS[host];
  if (siteSelectors) {
    for (const sel of siteSelectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => add(el.textContent));
      } catch {}
    }
  }

  // Generic fallback 1: elements whose class name contains "comment" or "reply"
  if (chunks.length < 3) {
    document
      .querySelectorAll("[class*='comment' i] p, [class*='reply' i] p, [class*='reaction' i] p")
      .forEach((el) => add(el.textContent));
  }

  // Generic fallback 2: article/section paragraphs
  if (chunks.length < 3) {
    document
      .querySelectorAll("article p, section p, [role='article'] p, main p")
      .forEach((el) => add(el.textContent));
  }

  // Last resort: all paragraphs
  if (chunks.length < 3) {
    document.querySelectorAll("p").forEach((el) => add(el.textContent));
  }

  return chunks.join("\n").slice(0, MAX_CHARS);
})();
