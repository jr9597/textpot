// WebSocket message types — mirrors the backend protocol exactly.
// Every message sent from the backend is one of these shapes.

export type SourceStatus = "loading" | "done" | "error";

export interface ScreenshotMessage {
  type: "screenshot";
  source: string;
  image: string; // base64-encoded PNG
}

export interface StatusMessage {
  type: "status";
  source: string;
  status: SourceStatus;
}

export interface ResultItem {
  title: string;
  summary: string;
  image_url: string | null;
  url: string;
  sentiment: "positive" | "neutral" | "negative";
}

export interface OverallSentiment {
  positive: number;
  neutral: number;
  negative: number;
}

export interface ResultData {
  content_type: "news_articles" | "blog_posts" | "forum_comments";
  results: ResultItem[];
  overall_sentiment: OverallSentiment;
  representative_quotes: string[];
}

export interface ResultsMessage {
  type: "results";
  source: string;
  data: ResultData;
  flag: string;
  language: string;
  name: string;
}

export interface SynthesisMessage {
  type: "synthesis";
  content: string;
}

export interface CompleteMessage {
  type: "complete";
}

export interface ChatResponseMessage {
  type: "chat_response";
  content: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type WSMessage =
  | ScreenshotMessage
  | StatusMessage
  | ResultsMessage
  | SynthesisMessage
  | CompleteMessage
  | ChatResponseMessage
  | ErrorMessage;

// Conversation history entry for the chat panel.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Per-source enriched result (includes display metadata).
export interface SourceResult {
  data: ResultData;
  flag: string;
  language: string;
  name: string;
}
