import { getConnection } from "./connection.service";
import {
  createApiGatewayClient,
  sendMessageToClient,
  getWebSocketEndpoint,
} from "../utils/websocket";
import { streamResponse, LLMRequest } from "./llm.service";
import { config } from "../config/config";
import {
  getChatSession,
  createChatSession,
  addMessageToChatSession,
  clearChatSessionHistory,
  ChatMessage,
} from "./chat-session.service";

export interface WebSocketMessage {
  action: string;
  data?: any;
}

export interface WebSocketResponse {
  message: string;
  data?: any;
}

/**
 * Format conversation history for LLM prompt
 */
const formatConversationHistory = (history: ChatMessage[]): string => {
  if (!history || history.length === 0) {
    return "";
  }

  // Exclude the most recent message since it will be added separately in the prompt
  const historyWithoutLatest = history.slice(0, -1);

  if (historyWithoutLatest.length === 0) {
    return "";
  }

  return historyWithoutLatest
    .map((msg) => {
      const role = msg.role === "user" ? "Human" : "Assistant";
      return `${role}: ${msg.content}`;
    })
    .join("\n\n");
};

/**
 * Handle incoming WebSocket message
 */
export const handleMessage = async (
  message: WebSocketMessage,
  connectionId: string,
  domainName: string,
  stage: string,
  apiId?: string,
  region?: string
): Promise<WebSocketResponse> => {
  try {
    console.log("Message processing started:", {
      action: message.action,
      connectionId,
      domainName,
      stage,
    });

    // Get connection details from DynamoDB
    const connection = await getConnection(connectionId);

    if (!connection) {
      console.warn(`Connection ${connectionId} not found in database`);
    } else {
      console.log("Connection details found:", connection.userId);
    }

    // Build the endpoint for the API Gateway Management API
    console.log("Building WebSocket endpoint");
    const endpoint = getWebSocketEndpoint(
      domainName || connection?.domainName || "",
      stage || connection?.stage || config.webSocket.defaultStage,
      apiId,
      region || config.region
    );
    console.log("WebSocket endpoint constructed:", endpoint);

    // Create the API Gateway Management API client
    const apiGatewayClient = createApiGatewayClient(endpoint);

    // Process the message based on action type
    let response: WebSocketResponse;

    if (message.action === "message") {
      // Send an initial acknowledgment response
      await sendMessageToClient(apiGatewayClient, connectionId, {
        action: "message_received",
        data: {
          message: "Processing your request...",
          timestamp: Date.now(),
        },
      });

      try {
        // Extract prompt and any LLM parameters from the message
        const userMessage = message.data?.message || "";
        const llmParameters = message.data?.parameters || {};
        const userId =
          connection?.userId || `user-${connectionId.substring(0, 8)}`;
        const sender =
          message.data?.sender || connection?.userEmail || "Anonymous";

        console.log(
          `Looking for chat session with connectionId: ${connectionId}`
        );

        // Get the existing chat session or create a new one if needed
        let chatSession = await getChatSession(connectionId);

        if (!chatSession) {
          console.log(
            `No chat session found for ${connectionId}, creating a new one`
          );
          chatSession = await createChatSession(connectionId, userId);
        } else {
          console.log(`Found existing chat session for ${connectionId}`);
        }

        // Handle special commands
        if (userMessage.trim().toLowerCase() === "/clear") {
          await clearChatSessionHistory(connectionId);

          // Send confirmation message
          response = {
            message: "Chat history cleared",
            data: {
              message:
                "Chat history has been cleared. Starting a new conversation.",
              sender: "System",
              timestamp: Date.now(),
            },
          };

          await sendMessageToClient(apiGatewayClient, connectionId, response);
          return response;
        }

        // Add user message to chat history
        const userChatMessage: ChatMessage = {
          role: "user",
          content: userMessage,
          timestamp: Date.now(),
        };

        console.log(`Adding user message to chat session: ${connectionId}`);
        await addMessageToChatSession(connectionId, userChatMessage);

        // Format conversation history for the LLM
        const conversationHistoryText = formatConversationHistory(
          chatSession.conversationHistory || []
        );

        // Create the prompt with conversation history
        const fullPrompt = conversationHistoryText
          ? `${conversationHistoryText}\n\nHuman: ${userMessage}\n\nAssistant:`
          : `Human: ${userMessage}\n\nAssistant:`;

        console.log("fullPrompt", fullPrompt);

        // Create LLM request
        const llmRequest: LLMRequest = {
          prompt: fullPrompt,
          parameters: llmParameters,
        };

        // Stream responses from the LLM service
        let fullResponse = "";

        await streamResponse(llmRequest, async (chunk) => {
          fullResponse += chunk.text;

          // Send the chunk to the client
          await sendMessageToClient(apiGatewayClient, connectionId, {
            action: "llm_response_chunk",
            data: {
              text: chunk.text,
              isComplete: chunk.isComplete,
              timestamp: Date.now(),
            },
          });
        });

        // Add assistant response to chat history
        const assistantChatMessage: ChatMessage = {
          role: "assistant",
          content: fullResponse,
          timestamp: Date.now(),
        };

        console.log(
          `Adding assistant response to chat session: ${connectionId}`
        );
        await addMessageToChatSession(connectionId, assistantChatMessage);

        // Send the completed response message
        response = {
          message: "LLM response complete",
          data: {
            message: fullResponse,
            sender,
            isComplete: true,
            timestamp: Date.now(),
          },
        };
      } catch (error) {
        console.error("Error processing LLM request:", error);

        // Send error response
        response = {
          message: "Error processing request",
          data: {
            message:
              "There was an error processing your request. Please try again.",
            sender: "System",
            error: true,
            timestamp: Date.now(),
          },
        };

        // Send final error message
        await sendMessageToClient(apiGatewayClient, connectionId, response);
      }
    } else if (message.action === "new_conversation") {
      // Clear the conversation history
      await clearChatSessionHistory(connectionId);

      response = {
        message: "New conversation started",
        data: {
          message: "Starting a new conversation.",
          sender: "System",
          timestamp: Date.now(),
        },
      };

      // Send response back to client
      await sendMessageToClient(apiGatewayClient, connectionId, response);
    } else {
      // Default response for other actions
      response = {
        message: "Unknown action",
        data: {
          message: "Hello from WebSocket Server",
          sender: "System",
          timestamp: Date.now(),
        },
      };

      // Send response back to the client for non-message actions
      await sendMessageToClient(apiGatewayClient, connectionId, response);
    }

    // For demonstration, broadcast could be implemented here
    if (message.action === "message" && config.webSocket.enableBroadcast) {
      console.log("Broadcasting feature would be implemented here");
      // Implementation for broadcasting to all connections would go here
    }

    return response;
  } catch (error) {
    console.error("Error handling message:", error);
    throw error;
  }
};