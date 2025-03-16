import {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  extractConnectionInfo,
  parseWebSocketEvent,
  createResponse,
} from "../utils/lambda";
import { handleMessage } from "../services/message.service";

/**
 * Handle WebSocket message event
 */
export const handler = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Message event:", JSON.stringify(event));

    // Extract connection information from the event
    const { connectionId, domainName, stage } = extractConnectionInfo(event);
    // Parse the WebSocket message
    const message = parseWebSocketEvent(event);

    // Handle the message
    const response = await handleMessage(
      message,
                //@ts-ignore
      connectionId,
      domainName,
      stage
    );

    // Return a successful response
    return createResponse(200, response);
  } catch (error) {
    console.error("Error handling message event:", error);
    return createResponse(500, { message: "Internal Server Error" });
  }
};
