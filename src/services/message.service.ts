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
 * Sanitize user input to prevent security issues while allowing legitimate code
 * @param input - The user input to sanitize
 * @returns The sanitized input and validation result
 */
const sanitizeUserInput = (input: string): { sanitized: string; valid: boolean; errorMessage?: string } => {
  // Check if input is defined and is a string
  if (input === undefined || input === null) {
    return { sanitized: "", valid: false, errorMessage: "Input cannot be empty" };
  }
  
  if (typeof input !== 'string') {
    return { sanitized: "", valid: false, errorMessage: "Input must be a string" };
  }

  // Trim whitespace
  const trimmedInput = input.trim();
  
  // Check for empty input after trimming
  if (trimmedInput.length === 0) {
    return { sanitized: "", valid: false, errorMessage: "Input cannot be empty" };
  }
  
  // Check for excessive length
  if (trimmedInput.length > MAX_MESSAGE_LENGTH) {
    return { 
      sanitized: trimmedInput.substring(0, MAX_MESSAGE_LENGTH), 
      valid: false, 
      errorMessage: `Input exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters` 
    };
  }

  // Only block the most dangerous patterns that could directly affect EC2 security
  // Allow normal code patterns, even if they include command syntax
  const directSystemExploitPatterns = [
    // Real system exploitation attempts with direct addressing
    /\/etc\/passwd/i,                                                       // System files access
    /\/var\/log/i,                                                          // System logs access
    /\/root\//i,                                                            // Root directory access
    /\/home\/[^\/]+\/\.ssh/i,                                               // SSH keys access
    /\/proc\/self/i,                                                        // Process info access
    
    // Actual command execution in context outside of code blocks
    /^\s*(?:sudo|apt-get|yum|rm\s+-rf)\s+/i,                               // Commands at start of message
    /\n\s*(?:sudo|apt-get|yum|chmod\s+777|rm\s+-rf)\s+/i,                  // Commands at start of line
    
    // Actual process execution methods
    /process\.exec\s*\(/i,                                                  // Node.js process execution
    /child_process\.exec/i,                                                 // Node.js child process explicit
    /os\.system\s*\(/i,                                                     // Python system commands
    /subprocess\.call\s*\(/i,                                               // Python subprocess
    /Runtime\.getRuntime\(\)\.exec\s*\(/i,                                 // Java runtime exec
    
    // Specific attack payloads
    /\|\|\s*curl\s+http/i,                                                  // Curl piped in shell
    /&&\s*wget\s+http/i,                                                    // Wget piped in shell
    /\|\|\s*nc\s+-e\s+\/bin\/bash/i,                                        // Netcat shell
    /\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i                          // Shellcode pattern
  ];

  // Check for direct system exploitation patterns
  for (const pattern of directSystemExploitPatterns) {
    if (pattern.test(trimmedInput)) {
      console.warn(`Potential EC2 exploitation attempt detected: matched pattern ${pattern}`);
      return { 
        sanitized: trimmedInput, 
        valid: false, 
        errorMessage: "Input contains potentially dangerous system access patterns" 
      };
    }
  }

  // Detect and block potential prompt injection attacks while allowing normal code
  const promptInjectionPatterns = [
    /ignore previous instructions/i,
    /ignore all previous commands/i,
    /disregard prior instructions/i,
    /override system prompt/i,
    /system:\s*[^\n]*/i,      // Attempts to mimic system messages
  ];

  // Check for prompt injection patterns
  for (const pattern of promptInjectionPatterns) {
    if (pattern.test(trimmedInput)) {
      console.warn(`Potential prompt injection detected: matched pattern ${pattern}`);
      return { 
        sanitized: trimmedInput, 
        valid: false, 
        errorMessage: "Input contains patterns that attempt to override system instructions" 
      };
    }
  }

  // Do minimal sanitization to preserve code functionality
  // Only sanitize the most dangerous characters that could lead to direct execution
  const sanitized = trimmedInput
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, "");  // Remove control chars but keep tabs and newlines for code

  return { sanitized, valid: true };
};

/**
 * Sanitize LLM parameters to ensure they're within acceptable bounds
 * @param params - The parameters to sanitize
 * @returns Sanitized parameters
 */
const sanitizeLLMParameters = (params: any = {}): any => {
  // Start with default parameters
  const sanitizedParams = { ...DEFAULT_PARAMS };
  
  // Process and validate each parameter
  if (typeof params.max_tokens === 'number' && params.max_tokens > 0) {
    sanitizedParams.max_tokens = Math.min(params.max_tokens, MAX_PARAMS.max_tokens);
  }
  
  if (typeof params.temperature === 'number' && params.temperature >= 0) {
    sanitizedParams.temperature = Math.min(params.temperature, MAX_PARAMS.temperature);
  }
  
  if (typeof params.top_p === 'number' && params.top_p > 0 && params.top_p <= MAX_PARAMS.top_p) {
    sanitizedParams.top_p = params.top_p;
  }
  
  if (typeof params.top_k === 'number' && params.top_k > 0) {
    sanitizedParams.top_k = Math.min(params.top_k, MAX_PARAMS.top_k);
  }
  
  if (typeof params.repetition_penalty === 'number' && params.repetition_penalty > 0) {
    sanitizedParams.repetition_penalty = Math.min(params.repetition_penalty, MAX_PARAMS.repetition_penalty);
  }
  
  // Handle stop tokens (if provided)
  if (Array.isArray(params.stop)) {
    // Only accept string stop tokens and limit their number
    sanitizedParams.stop = params.stop
      .filter((token: any) => typeof token === 'string')
      .slice(0, 5); // Limit to 5 stop tokens
  }
  
  return sanitizedParams;
};

/**
 * Safely sanitize user input with error handling
 * @param input - User input to sanitize
 */
const safelySanitizeInput = (input: any): { sanitized: string; valid: boolean; errorMessage?: string } => {
  try {
    return sanitizeUserInput(String(input || ""));
  } catch (error) {
    console.error("Error in sanitizeUserInput:", error);
    return { 
      sanitized: "", 
      valid: false, 
      errorMessage: "Failed to process input due to an internal error"
    };
  }
};

/**
 * Safely sanitize LLM parameters with error handling
 * @param params - Parameters to sanitize
 */
const safelySanitizeParameters = (params: any): any => {
  try {
    return sanitizeLLMParameters(params);
  } catch (error) {
    console.error("Error in sanitizeLLMParameters:", error);
    // Return default parameters if there's an error
    return { ...DEFAULT_PARAMS };
  }
};

/**
 * Validate the overall message structure
 * @param message - The WebSocket message to validate
 * @returns Whether the message is valid
 */
const validateMessageStructure = (message: WebSocketMessage): { valid: boolean; errorMessage?: string } => {
  // Validate action
  if (!message || typeof message.action !== 'string') {
    return { valid: false, errorMessage: "Invalid message format: missing or invalid action" };
  }

  // For message actions, validate data structure
  if (message.action === "message") {
    // Check if data exists
    if (!message.data) {
      return { valid: false, errorMessage: "Invalid message format: missing data" };
    }

    // Validate message content
    if (message.data.message === undefined) {
      return { valid: false, errorMessage: "Invalid message format: missing message content" };
    }

    // Validate parameters if present
    if (message.data.parameters !== undefined && 
        (typeof message.data.parameters !== 'object' || Array.isArray(message.data.parameters))) {
      return { valid: false, errorMessage: "Invalid message format: parameters must be an object" };
    }
  }

  return { valid: true };
};

/**
 * Safely sanitize user input with minimal modifications
 * More permissive than the main sanitization to preserve code
 * @param input User input to sanitize with minimal changes
 */
const lightlySanitizeInput = (input: string): string => {
  try {
    if (!input || typeof input !== 'string') {
      return "";
    }
    
    // Only remove control characters that could break processing
    return input
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, ""); // Keep tabs and newlines for code
  } catch (error) {
    console.error("Error in lightlySanitizeInput:", error);
    return input; // Return original on error
  }
};

/**
 * Format conversation history for LLM prompt
 * Preserves code blocks and applies minimal sanitization to history
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
    const validationResult = validateMessageStructure(message);
    if (!validationResult.valid) {
      console.warn(`Invalid message structure: ${validationResult.errorMessage}`);
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

        // Log security-relevant information for monitoring
        console.log({
          event: "message_received",
          connectionId,
          userId,
          messageLength: userMessage.length,
          hasParameters: Object.keys(llmParameters).length > 0,
          timestamp: Date.now()
        });

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

        // Sanitize user input
        const sanitizeResult = safelySanitizeInput(userMessage);
        
        // Handle invalid input
        if (!sanitizeResult.valid) {
          console.warn(`Input sanitization failed for connection ${connectionId}: ${sanitizeResult.errorMessage}`);
          
          // Log security event for potential threats
          console.error({
            event: "security_threat_detected",
            connectionId,
            userId,
            reason: sanitizeResult.errorMessage,
            timestamp: Date.now()
          });
          
          response = {
            message: "Invalid input",
            data: {
              message: sanitizeResult.errorMessage || "Your input could not be processed. Please try again.",
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
            timestamp: Date.now()
          });
        }

        // Add user message to chat history
        const userChatMessage: ChatMessage = {
          role: "user",
          content: sanitizedMessage, // Use sanitized message
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
          ? `${conversationHistoryText}\n\nHuman: ${sanitizedMessage}\n\nAssistant:`
          : `Human: ${sanitizedMessage}\n\nAssistant:`;

        // Log prompt size for monitoring
        console.log({
          event: "prompt_created",
          connectionId,
          userId,
          promptLength: fullPrompt.length,
          messageCount: (chatSession.conversationHistory?.length || 0) + 1,
          timestamp: Date.now()
        });

        // Sanitize LLM parameters
        const sanitizedParameters = safelySanitizeParameters(llmParameters);
        
        // Log if parameters were modified during sanitization (for security monitoring)
        if (JSON.stringify(sanitizedParameters) !== JSON.stringify(llmParameters)) {
          console.warn({
            event: "parameters_sanitized",
            connectionId,
            userId,
            originalParameters: JSON.stringify(llmParameters),
            sanitizedParameters: JSON.stringify(sanitizedParameters),
            timestamp: Date.now()
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
          codeBlockTypes: new Set<string>()
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
          
          // For long streams, log progress periodically
          if (chunkCount % 20 === 0) {
            console.log({
              event: "llm_stream_progress",
              connectionId,
              userId,
              chunkCount,
              responseLength: fullResponse.length,
              timestamp: Date.now()
            });
          }
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
          timestamp: Date.now()
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

        // Log detailed error information for security monitoring
        console.error({
          event: "llm_request_error",
          connectionId,
          userId: connection?.userId || `user-${connectionId.substring(0, 8)}`,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: Date.now()
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
              timestamp: Date.now()
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
              timestamp: Date.now()
            });
          }
        }

        // Send error response
        response = {
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