import { getConnection } from "./connection.service";
import {
  createApiGatewayClient,
  sendMessageToClient,
  getWebSocketEndpoint,
} from "../utils/websocket";
import { streamResponse, LLMRequest } from "./llm.service";
import { config } from "../config/config";

export interface WebSocketMessage {
  action: string;
  data?: any;
}

export interface WebSocketResponse {
  message: string;
  data?: any;
}

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
      message,
      connectionId,
      domainName,
      stage,
      apiId,
      region: region || config.region,
    });

    // Get connection details from DynamoDB
    const connection = await getConnection(connectionId);

    if (!connection) {
      console.warn(`Connection ${connectionId} not found in database`);
    } else {
      console.log("Connection details:", connection);
    }

    // Build the endpoint for the API Gateway Management API
    console.log("Building WebSocket endpoint with:", {
      domainName: domainName || connection?.domainName,
      stage: stage || connection?.stage || config.webSocket.defaultStage,
      apiId,
      region: region || config.region,
    });

    // Use connection's domain and stage if available (as a fallback)
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
        const prompt = message.data?.message || "";
        const llmParameters = message.data?.parameters || {};
        const sender =
          message.data?.sender || connection?.userEmail || "Anonymous";

        // Create LLM request
        const llmRequest: LLMRequest = {
          prompt,
          parameters: llmParameters,
        };

        // Stream responses from the LLM service
        let fullResponse = "";

        await streamResponse(llmRequest, async (chunk) => {
          console.log("fullResponse1111", fullResponse);
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