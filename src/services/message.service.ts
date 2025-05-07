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
import * as sanitizationUtils from "../utils/sanitization";
import * as conversationUtils from "../utils/conversation";

export interface WebSocketMessage {
  action: string;
  data?: any;
}

export interface WebSocketResponse {
  message: string;
  data?: any;
}

// Maximum allowed message length (characters)
// Set high enough to allow code samples
const MAX_MESSAGE_LENGTH = 100000;

// Default and maximum parameter values for safety
const DEFAULT_PARAMS = {
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 1.0,
  top_k: 40,
  repetition_penalty: 1.0,
  stop: [],
};

const MAX_PARAMS = {
  max_tokens: 4096,
  temperature: 2.0,
  top_p: 1.0,
  top_k: 100,
  repetition_penalty: 2.0,
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

    // Validate message structure
    const validationResult =
      sanitizationUtils.validateMessageStructure(message);
    if (!validationResult.valid) {
      console.warn(
        `Invalid message structure: ${validationResult.errorMessage}`
      );
      return {
        message: "Invalid message",
        data: {
          message: validationResult.errorMessage,
          sender: "System",
          error: true,
          timestamp: Date.now(),
        },
      };
    }

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
      response = await handleChatMessage(
        message,
        connectionId,
        apiGatewayClient,
        connection
      );
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

/**
 * Handle chat messages including LLM processing
 */
async function handleChatMessage(
  message: WebSocketMessage,
  connectionId: string,
  apiGatewayClient: any,
  connection: any
): Promise<WebSocketResponse> {
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
    const userId = connection?.userId || `user-${connectionId.substring(0, 8)}`;
    const sender = message.data?.sender || connection?.userEmail || "Anonymous";

    // Log security-relevant information for monitoring
    console.log({
      event: "message_received",
      connectionId,
      userId,
      messageLength: userMessage.length,
      hasParameters: Object.keys(llmParameters).length > 0,
      timestamp: Date.now(),
    });

    console.log(`Looking for chat session with connectionId: ${connectionId}`);

    // Get the existing chat session or create a new one if needed
    const chatSession = await getOrCreateChatSession(connectionId, userId);

    // Handle special commands
    if (userMessage.trim().toLowerCase() === "/clear") {
      return await handleClearCommand(connectionId, apiGatewayClient);
    }

    // Sanitize user input
    const sanitizeResult = sanitizationUtils.safelySanitizeInput(userMessage);

    // Handle invalid input
    if (!sanitizeResult.valid) {
      console.warn(
        `Input sanitization failed for connection ${connectionId}: ${sanitizeResult.errorMessage}`
      );

      // Log security event for potential threats
      console.error({
        event: "security_threat_detected",
        connectionId,
        userId,
        reason: sanitizeResult.errorMessage,
        timestamp: Date.now(),
      });

      const response = {
        message: "Invalid input",
        data: {
          message:
            sanitizeResult.errorMessage ||
            "Your input could not be processed. Please try again.",
          sender: "System",
          error: true,
          timestamp: Date.now(),
        },
      };

      await sendMessageToClient(apiGatewayClient, connectionId, response);
      return response;
    }

    // Use the sanitized input for further processing
    const sanitizedMessage = sanitizeResult.sanitized;

    // Log if message was modified during sanitization (for security monitoring)
    if (sanitizedMessage !== userMessage) {
      console.warn({
        event: "input_sanitized",
        connectionId,
        userId,
        originalLength: userMessage.length,
        sanitizedLength: sanitizedMessage.length,
        timestamp: Date.now(),
      });
    }

    // Process the message with the LLM
    return await processWithLLM(
      sanitizedMessage,
      llmParameters,
      connectionId,
      userId,
      sender,
      chatSession,
      apiGatewayClient
    );
  } catch (error) {
    return await handleLLMError(
      error,
      connectionId,
      connection,
      apiGatewayClient
    );
  }
}

/**
 * Get existing chat session or create a new one
 */
async function getOrCreateChatSession(connectionId: string, userId: string) {
  let chatSession = await getChatSession(connectionId);

  if (!chatSession) {
    console.log(
      `No chat session found for ${connectionId}, creating a new one`
    );
    chatSession = await createChatSession(connectionId, userId);
  } else {
    console.log(`Found existing chat session for ${connectionId}`);
  }

  return chatSession;
}

/**
 * Handle the /clear command
 */
async function handleClearCommand(
  connectionId: string,
  apiGatewayClient: any
): Promise<WebSocketResponse> {
  await clearChatSessionHistory(connectionId);

  // Send confirmation message
  const response = {
    message: "Chat history cleared",
    data: {
      message: "Chat history has been cleared. Starting a new conversation.",
      sender: "System",
      timestamp: Date.now(),
    },
  };

  await sendMessageToClient(apiGatewayClient, connectionId, response);
  return response;
}

/**
 * Process the message with the LLM service
 */
async function processWithLLM(
  sanitizedMessage: string,
  llmParameters: any,
  connectionId: string,
  userId: string,
  sender: string,
  chatSession: any,
  apiGatewayClient: any
): Promise<WebSocketResponse> {
  // Add user message to chat history
  const userChatMessage: ChatMessage = {
    role: "user",
    content: sanitizedMessage,
    timestamp: Date.now(),
  };

  console.log(`Adding user message to chat session: ${connectionId}`);
  await addMessageToChatSession(connectionId, userChatMessage);

  // Format conversation history for the LLM
  const conversationHistoryText = conversationUtils.formatConversationHistory(
    chatSession.conversationHistory || []
  );

  // Create the prompt with conversation history
  const fullPrompt = conversationHistoryText
    ? `${conversationHistoryText}\n\nHuman: ${sanitizedMessage}\n\nAssistant:`
    : `Human: ${sanitizedMessage}\n\nAssistant:`;

  // Log prompt size for monitoring
  console.log({
    event: "prompt_created",
    connectionId,
    userId,
    promptLength: fullPrompt.length,
    messageCount: (chatSession.conversationHistory?.length || 0) + 1,
    timestamp: Date.now(),
  });

  // Sanitize LLM parameters
  const sanitizedParameters =
    sanitizationUtils.safelySanitizeParameters(llmParameters);

  // Log if parameters were modified during sanitization (for security monitoring)
  if (JSON.stringify(sanitizedParameters) !== JSON.stringify(llmParameters)) {
    console.warn({
      event: "parameters_sanitized",
      connectionId,
      userId,
      originalParameters: JSON.stringify(llmParameters),
      sanitizedParameters: JSON.stringify(sanitizedParameters),
      timestamp: Date.now(),
    });
  }

  // Create LLM request with sanitized parameters
  const llmRequest: LLMRequest = {
    prompt: fullPrompt,
    parameters: sanitizedParameters,
  };

  // Stream responses from the LLM service
  let fullResponse = "";
  let chunkCount = 0;
  let securityMonitoring = {
    containsSystemCommands: false,
    containsCodeBlock: false,
    codeBlockCount: 0,
    codeBlockTypes: new Set<string>(),
  };

  await streamResponse(llmRequest, async (chunk) => {
    fullResponse += chunk.text;
    chunkCount++;

    // Monitor code content in the LLM response - just for logging, not filtering
    // Detect code blocks for logging purposes
    const codeBlockMatch = chunk.text.match(/```([a-zA-Z0-9_]+)?/);
    if (codeBlockMatch) {
      securityMonitoring.containsCodeBlock = true;
      securityMonitoring.codeBlockCount++;

      // Track the type of code if specified
      if (codeBlockMatch[1]) {
        securityMonitoring.codeBlockTypes.add(codeBlockMatch[1]);
      }
    }

    // Only monitor for actual dangerous system commands that could be copied
    // This is for logging only, not for blocking or filtering
    if (/\b(sudo rm -rf|chmod 777|chown root:|mkfs)\b/i.test(chunk.text)) {
      securityMonitoring.containsSystemCommands = true;
    }

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

  // Log security monitoring results at the end of response
  console.log({
    event: "llm_response_monitoring",
    connectionId,
    userId,
    responseLength: fullResponse.length,
    totalChunks: chunkCount,
    codeBlockCount: securityMonitoring.codeBlockCount,
    codeBlockTypes: Array.from(securityMonitoring.codeBlockTypes),
    containsSystemCommands: securityMonitoring.containsSystemCommands,
    timestamp: Date.now(),
  });

  // Add assistant response to chat history
  const assistantChatMessage: ChatMessage = {
    role: "assistant",
    content: fullResponse,
    timestamp: Date.now(),
  };

  console.log(`Adding assistant response to chat session: ${connectionId}`);
  await addMessageToChatSession(connectionId, assistantChatMessage);

  // Send the completed response message
  const response = {
    message: "LLM response complete",
    data: {
      message: fullResponse,
      sender,
      isComplete: true,
      timestamp: Date.now(),
    },
  };

  return response;
}

/**
 * Handle errors from the LLM service
 */
async function handleLLMError(
  error: any,
  connectionId: string,
  connection: any,
  apiGatewayClient: any
): Promise<WebSocketResponse> {
  console.error("Error processing LLM request:", error);

  // Log detailed error information for security monitoring
  console.error({
    event: "llm_request_error",
    connectionId,
    userId: connection?.userId || `user-${connectionId.substring(0, 8)}`,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: Date.now(),
  });

  // Check if the error is a connection failure
  let errorMessage =
    "There was an error processing your request. Please try again.";
  let errorCategory = "general_error";

  if (error instanceof Error) {
    // Check for connection failure messages (EC2 connectivity issues)
    if (
      error.message.includes("Failed to connect") ||
      error.message.includes("connection failed") ||
      error.message.includes("Connection refused") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("socket hang up") ||
      error.message.includes("network timeout")
    ) {
      errorMessage =
        "LLM service connection failed. Please check that the LLM service is running and try again.";
      errorCategory = "ec2_connection_failure";
      console.error({
        event: "ec2_connection_failure",
        connectionId,
        errorDetails: error.message,
        timestamp: Date.now(),
      });
    }

    // Check for potential memory or resource constraints on EC2
    if (
      error.message.includes("out of memory") ||
      error.message.includes("resource exhausted") ||
      error.message.includes("timeout") ||
      error.message.includes("too many requests")
    ) {
      errorMessage =
        "The LLM service is currently experiencing high load or resource constraints. Please try again with a shorter message or wait a few minutes.";
      errorCategory = "ec2_resource_constraint";
      console.error({
        event: "ec2_resource_constraint",
        connectionId,
        errorDetails: error.message,
        timestamp: Date.now(),
      });
    }
  }

  // Send error response
  const response = {
    message: "Error processing request",
    data: {
      message: errorMessage,
      sender: "System",
      error: true,
      errorCategory,
      timestamp: Date.now(),
    },
  };

  // Send final error message
  await sendMessageToClient(apiGatewayClient, connectionId, response);
  return response;
}