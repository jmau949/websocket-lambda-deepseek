import {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  extractConnectionInfo,
  parseWebSocketEvent,
  createResponse,
} from "../utils/lambda";
import {
  createApiGatewayClient,
  sendMessageToClient,
  getWebSocketEndpoint,
} from "../utils/websocket";

/**
 * Handle WebSocket $default event
 */
export const handler = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Default event:", JSON.stringify(event));

    // Extract connection information from the event
    const { connectionId, domainName, stage } = extractConnectionInfo(event);

    // Parse the WebSocket message
    const message = parseWebSocketEvent(event);

    // Create a response message
    const response = {
      message: "Unknown action type. Please send a valid action.",
      receivedAction: message.action || "undefined",
    };

    // Send response back to the client
    //@ts-ignore
    const endpoint = getWebSocketEndpoint(domainName, stage);
    const apiGatewayClient = createApiGatewayClient(endpoint);
    //@ts-ignore
    await sendMessageToClient(apiGatewayClient, connectionId, response);

    // Return a successful response
    return createResponse(200, response);
  } catch (error) {
    console.error("Error handling default event:", error);
    return createResponse(500, { message: "Internal Server Error" });
  }
};
