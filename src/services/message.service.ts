import { getConnection } from "./connection.service";
import {
  createApiGatewayClient,
  sendMessageToClient,
  getWebSocketEndpoint,
} from "../utils/websocket";
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

    // Process the message based on action type
    let response: WebSocketResponse;

    if (message.action === "message") {
      // Handle chat messages
      response = {
        message: "Message received",
        data: {
          message: "REPLACEME LLM OUTPUT",
          sender: message.data?.sender || connection?.userEmail || "Anonymous",
          timestamp: Date.now(),
        },
      };
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

    // Send response back to the client
    console.log("Sending response to client:", response);
    await sendMessageToClient(apiGatewayClient, connectionId, response);
    console.log("Response sent successfully");

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