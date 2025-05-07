import {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResult,
} from "aws-lambda";
import { extractConnectionInfo, createResponse } from "../utils/lambda";
import { deleteConnection } from "../services/connection.service";
import { deleteChatSession } from "../services/chat-session.service";

/**
 * Handle WebSocket $disconnect event
 */
export const handler = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Disconnect event:", JSON.stringify(event));

    // Extract connection ID from the event
    const { connectionId } = extractConnectionInfo(event);

    // Delete the connection from DynamoDB
    //@ts-ignore
    await deleteConnection(connectionId);
    // Delete the chat session for this connection
    // try {
    //   await deleteChatSession(connectionId);
    //   console.log(`Chat session for ${connectionId} deleted`);
    // } catch (error) {
    //   console.warn(`Error deleting chat session for ${connectionId}:`, error);
    //   // Continue with disconnect process even if chat session deletion fails
    // }

    // Return a successful response
    return createResponse(200, { message: "Disconnected" });
  } catch (error) {
    console.error("Error handling disconnect event:", error);
    return createResponse(500, { message: "Internal Server Error" });
  }
};
