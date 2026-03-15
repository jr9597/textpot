from dataclasses import dataclass
from urllib.parse import quote_plus


@dataclass
class SourceConfig:
    id: str
    name: str
    flag: str
    language: str
    start_url: str          # search-results URL template — {query} is URL-encoded query
    task_template: str
    locale: str = "en-US"           # Playwright context locale
    accept_language: str = "en-US,en;q=0.9"  # HTTP Accept-Language header


# Shared task template. The agent lands directly on a results page
# (no search-box navigation needed) and scrolls to extract results.
#
# Key instructions:
# - Look for visible URLs/hrefs in result snippets, breadcrumbs, and link text
# - Extract discussions and opinion content, not just news headlines
# - Minimum viable: 3 results if 5 aren't available
_TASK_TEMPLATE = """
You are already on a {platform_type} results page showing results for a query in {language}.
Do NOT search again or navigate away — you are already on the right page.

Your task:
1. Read the visible results on this page
2. Click into the first 3 results one by one — read each full page, then press the back button to return to results
3. Scroll down to see more results and extract 2 more from the snippets
4. Total: 5 results — prioritise posts with opinions, reactions, and discussions over plain news

For EACH result, extract:
- title: Translated to English
- summary: 2-3 sentence English summary of what this post/article actually says or argues
- url: The direct link. Look carefully — URLs often appear as:
    * Visible text below titles (e.g. "search.naver.com/...")
    * Breadcrumb paths
    * Small grey text under the title
    * The link text itself if it contains a domain
  If you can identify a partial URL or domain + path, construct the full URL.
  If genuinely not visible, use null.
- image_url: Hero image or thumbnail URL if visible, else null
- sentiment: "positive", "neutral", or "negative" toward the topic

Content type — classify what you actually see:
- "news_articles": news headlines with publication names and dates
- "blog_posts": personal opinions, social posts, reviews
- "forum_comments": threaded replies, comment sections, Q&A threads

If content_type is "forum_comments":
- Provide overall_sentiment as percentages summing to 100
- Provide 3 representative_quotes translated to English

For news_articles and blog_posts, estimate overall_sentiment from the tone of the results combined.

Output ONLY this JSON — no markdown fences, no explanation:

{{
  "content_type": "news_articles",
  "results": [
    {{
      "title": "English title",
      "summary": "English summary describing what this post/article says about the topic",
      "url": "https://full-url-or-null",
      "image_url": null,
      "sentiment": "positive"
    }}
  ],
  "overall_sentiment": {{
    "positive": 60,
    "neutral": 25,
    "negative": 15
  }},
  "representative_quotes": []
}}

Rules:
- Replace "news_articles" with the actual content_type you observed
- Sentiment percentages must sum to 100
- Output minimum 1 result even if you can only find one
- Raw JSON only — no markdown, no text before or after
"""


def _search_url(template: str, query: str) -> str:
    """Build a search-results URL with the query URL-encoded."""
    return template.replace("{query}", quote_plus(query))


SOURCES: dict[str, SourceConfig] = {
    "naver": SourceConfig(
        id="naver",
        name="Naver",
        flag="🇰🇷",
        language="Korean",
        # Naver blog search — surfaces opinion posts and community content,
        # which gives richer sentiment signals than the default news tab
        start_url="https://search.naver.com/search.naver?query={query}&where=post",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "Korean")
            .replace("{platform_type}", "Naver blog/post"),
        locale="ko-KR",
        accept_language="ko-KR,ko;q=0.9,en;q=0.8",
    ),
    "yahoo_japan": SourceConfig(
        id="yahoo_japan",
        name="Yahoo Japan",
        flag="🇯🇵",
        language="Japanese",
        # Yahoo Japan news search — well-structured results with visible URLs
        start_url="https://news.yahoo.co.jp/search?p={query}",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "Japanese")
            .replace("{platform_type}", "Yahoo Japan news"),
        locale="ja-JP",
        accept_language="ja-JP,ja;q=0.9,en;q=0.8",
    ),
    "baidu": SourceConfig(
        id="baidu",
        name="Baidu",
        flag="🇨🇳",
        language="Chinese",
        # Baidu web search — regular results page, less CAPTCHA-prone than Tieba
        start_url="https://www.baidu.com/s?wd={query}&rn=10",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "Chinese")
            .replace("{platform_type}", "Baidu web search"),
        locale="zh-CN",
        accept_language="zh-CN,zh;q=0.9,en;q=0.8",
    ),
    "dcard": SourceConfig(
        id="dcard",
        name="Dcard",
        flag="🇹🇼",
        language="Traditional Chinese",
        # Dcard — Taiwan's largest student/young adult forum, rich discussion content
        start_url="https://www.dcard.tw/search?query={query}",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "Traditional Chinese")
            .replace("{platform_type}", "Dcard forum"),
        locale="zh-TW",
        accept_language="zh-TW,zh;q=0.9,en;q=0.8",
    ),
    "seznam": SourceConfig(
        id="seznam",
        name="Seznam",
        flag="🇨🇿",
        language="Czech",
        # Seznam — Czech Republic's dominant search engine and news portal
        start_url="https://search.seznam.cz/?q={query}",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "Czech")
            .replace("{platform_type}", "Seznam search"),
        locale="cs-CZ",
        accept_language="cs-CZ,cs;q=0.9,en;q=0.8",
    ),
    "reddit": SourceConfig(
        id="reddit",
        name="Reddit",
        flag="🟠",
        language="English",
        # Reddit search sorted by top — surfaces high-engagement discussions
        start_url="https://www.reddit.com/search/?q={query}&sort=top&t=year",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "English")
            .replace("{platform_type}", "Reddit discussion"),
        locale="en-US",
        accept_language="en-US,en;q=0.9",
    ),
    "threads": SourceConfig(
        id="threads",
        name="Threads",
        flag="🧵",
        language="English",
        # Threads.net public search — Meta's social platform, opinion-heavy posts
        start_url="https://www.threads.net/search?q={query}&serp_type=default",
        task_template=_TASK_TEMPLATE
            .replace("{language}", "English")
            .replace("{platform_type}", "Threads social"),
        locale="en-US",
        accept_language="en-US,en;q=0.9",
    ),
}
