/**
 * Utilities for formatting and managing conversation data
 */

import { ChatMessage } from "../services/chat-session.service";
import { lightlySanitizeInput } from "./sanitization";

/**
 * Format conversation history for LLM prompt
 * Preserves code blocks and applies minimal sanitization to history
 */
export const formatConversationHistory = (history: ChatMessage[]): string => {
  if (!history || history.length === 0) {
    return "";
  }

  // Exclude the most recent message since it will be added separately in the prompt
  const historyWithoutLatest = history.slice(0, -1);

  if (historyWithoutLatest.length === 0) {
    return "";
  }

  // Maximum allowed messages in history to prevent excessive token usage
  const MAX_HISTORY_MESSAGES = 50; // Allow more context for code discussions

  // Limit the number of messages to prevent token explosion
  const limitedHistory = historyWithoutLatest.slice(-MAX_HISTORY_MESSAGES);

  return limitedHistory
    .map((msg) => {
      const role = msg.role === "user" ? "Human" : "Assistant";

      // Use light sanitization for history to preserve code formatting
      const content = lightlySanitizeInput(msg.content);

      return `${role}: ${content}`;
    })
    .join("\n\n");
};
