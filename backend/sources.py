from dataclasses import dataclass
from urllib.parse import quote_plus


@dataclass
class SourceConfig:
    id: str
    name: str
    flag: str
    language: str
    start_url: str          # search-results URL template with {query} placeholder
    task_template: str


# Task template for agents that land directly on a search-results page.
# No navigation or search-box interaction needed — the agent only scrolls,
# reads, and extracts. This eliminates the biggest source of wasted iterations.
#
# "Retrieve as you go" instruction: the agent is told to output a partial
# JSON result after every ~2 pages of scrolling rather than waiting until
# the very end. The backend parses and forwards each partial result as it
# arrives so the frontend can populate columns progressively.
_TASK_TEMPLATE = """
You are already on a search results page showing results for "{query}" in {language}.
Do NOT navigate away or search again — you are already in the right place.

Your job:
1. Read the visible results on this page
2. Scroll down 2-3 times to load more results
3. Extract the 5 most relevant, interesting results you find

For EACH result extract:
- title: translated to English
- summary: 1-2 sentence summary translated to English describing what the post/article says
- url: the direct link to the result (look for href values, post permalinks, or article URLs)
- image_url: thumbnail/hero image URL if visible, otherwise null
- sentiment: "positive", "neutral", or "negative" toward the topic

Content type classification — look at what you actually see:
- "news_articles": headline-driven articles with bylines and dates
- "blog_posts": personal posts, opinion pieces, social media posts
- "forum_comments": threaded replies, comment sections, discussion boards

If content_type is "forum_comments", also provide:
- overall_sentiment breakdown as percentages (must sum to 100)
- 3 representative_quotes translated to English

For news_articles and blog_posts, estimate overall_sentiment from the tone of all results combined.

When done scrolling and reading, output ONLY this JSON and nothing else:

{{
  "content_type": "news_articles",
  "results": [
    {{
      "title": "English title",
      "summary": "English summary of what this result says about the topic",
      "url": "https://full-url-to-result",
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
- Output ONLY the raw JSON — no markdown, no explanation, no code fences
- If you cannot find 5 results, output what you found (minimum 1)
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
        # Naver integrated search — shows news, blog, café results together
        start_url="https://search.naver.com/search.naver?query={query}&where=nexearch",
        task_template=_TASK_TEMPLATE.replace("{language}", "Korean"),
    ),
    "yahoo_japan": SourceConfig(
        id="yahoo_japan",
        name="Yahoo Japan",
        flag="🇯🇵",
        language="Japanese",
        # Yahoo Japan web search
        start_url="https://search.yahoo.co.jp/search?p={query}",
        task_template=_TASK_TEMPLATE.replace("{language}", "Japanese"),
    ),
    "baidu": SourceConfig(
        id="baidu",
        name="Baidu",
        flag="🇨🇳",
        language="Chinese",
        # Baidu web search — lands directly on results
        start_url="https://www.baidu.com/s?wd={query}",
        task_template=_TASK_TEMPLATE.replace("{language}", "Chinese"),
    ),
    "weibo": SourceConfig(
        id="weibo",
        name="Weibo",
        flag="🇨🇳",
        language="Chinese",
        # Weibo search — shows public posts about the topic
        start_url="https://s.weibo.com/weibo?q={query}&Refer=index",
        task_template=_TASK_TEMPLATE.replace("{language}", "Chinese"),
    ),
}
