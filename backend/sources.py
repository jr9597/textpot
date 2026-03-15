from dataclasses import dataclass


@dataclass
class SourceConfig:
    id: str
    name: str
    flag: str
    language: str
    start_url: str
    task_template: str


_TASK_TEMPLATE = """
You are a research agent. Your task is to search for information about "{query}" on this website and extract structured results.

Instructions:
1. Navigate the site and search for "{query}" translated into {language}
2. Scroll through results to find at least 5 relevant items
3. Extract the top 5 results

For each result, translate the title and summary to English.

Look at the page content and classify it as one of:
- "news_articles" if you see news articles with headlines and publication details
- "blog_posts" if you see opinion pieces or personal posts
- "forum_comments" if you see comments, replies, discussions, or social media posts

If the content is forum_comments:
- Calculate approximate sentiment: what % of posts/comments are positive, neutral, negative about the topic
- Extract 3 representative translated quotes that best represent the discussion

When you have enough information (after browsing and scrolling through results), return ONLY this JSON with no other text:

{{
  "content_type": "news_articles",
  "results": [
    {{
      "title": "translated title in English",
      "summary": "1-2 sentence summary in English",
      "image_url": "url or null",
      "url": "original article url",
      "sentiment": "positive"
    }}
  ],
  "overall_sentiment": {{
    "positive": 60,
    "neutral": 25,
    "negative": 15
  }},
  "representative_quotes": [
    "translated quote 1",
    "translated quote 2",
    "translated quote 3"
  ]
}}

Replace "news_articles" with the actual content type you observed.
Ensure sentiment values sum to 100.
Return ONLY valid JSON — no explanation, no markdown code blocks, just the raw JSON object.
"""


SOURCES: dict[str, SourceConfig] = {
    "naver": SourceConfig(
        id="naver",
        name="Naver",
        flag="🇰🇷",
        language="Korean",
        start_url="https://www.naver.com",
        task_template=_TASK_TEMPLATE.replace("{language}", "Korean"),
    ),
    "yahoo_japan": SourceConfig(
        id="yahoo_japan",
        name="Yahoo Japan",
        flag="🇯🇵",
        language="Japanese",
        start_url="https://www.yahoo.co.jp",
        task_template=_TASK_TEMPLATE.replace("{language}", "Japanese"),
    ),
    "baidu": SourceConfig(
        id="baidu",
        name="Baidu",
        flag="🇨🇳",
        language="Chinese",
        start_url="https://www.baidu.com",
        task_template=_TASK_TEMPLATE.replace("{language}", "Chinese"),
    ),
    "weibo": SourceConfig(
        id="weibo",
        name="Weibo",
        flag="🇨🇳",
        language="Chinese",
        start_url="https://s.weibo.com",
        task_template=_TASK_TEMPLATE.replace("{language}", "Chinese"),
    ),
}
