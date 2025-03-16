import { getConnection } from "./connection.service";
import {
  createApiGatewayClient,
  sendMessageToClient,
  getWebSocketEndpoint,
} from "../utils/websocket";
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
  stage: string
): Promise<WebSocketResponse> => {
  try {
    // Get connection details from DynamoDB
    const connection = await getConnection(connectionId);

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Process the message based on action type
    let response: WebSocketResponse;

    if (message.action === "message") {
      // Handle chat messages
      response = {
        message: "Message received",
        data: {
          message: message.data?.message || "No message content",
          sender: message.data?.sender || "Anonymous",
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

    // Send response back to the client
    const endpoint = getWebSocketEndpoint(domainName, stage);
    const apiGatewayClient = createApiGatewayClient(endpoint);
    await sendMessageToClient(apiGatewayClient, connectionId, response);

    // Broadcast message to all connected clients (for chat functionality)
    if (message.action === "message") {
      // In a real implementation, you would query DynamoDB for all active connections
      // and send the message to each one. For local development, this is simplified.
      console.log("Broadcasting message to other clients would happen here");
    }

    return response;
  } catch (error) {
    console.error("Error handling message:", error);
    throw error;
  }
};
