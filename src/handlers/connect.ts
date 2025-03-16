import {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResult,
} from "aws-lambda";
import { extractConnectionInfo, createResponse } from "../utils/lambda";
import { saveConnection } from "../services/connection.service";

/**
 * Handle WebSocket $connect event
 *
 * Authentication is handled by the API Gateway Cognito authorizer,
 * which validates the JWT cookie before this Lambda is invoked.
 * If the request reaches this handler, it's already authenticated.
 */
export const handler = async (
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Connect event:", JSON.stringify(event));

    // Extract connection information from the event
    const { connectionId, domainName, stage } = extractConnectionInfo(event);

    // Extract user details from the authorizer context (added by Cognito authorizer)
    const authorizer = (event.requestContext as any).authorizer || {};

    const claims = authorizer.jwt?.claims || {};

    // Get user identity from claims
    const userId = claims.sub || claims["cognito:username"] || "";
    const userEmail = claims.email || "";

    console.log("Authenticated user:", { userId, userEmail });

    // Save the connection to DynamoDB with user info
    await saveConnection({
      //@ts-ignore
      connectionId,
      domainName,
      stage,
      timestamp: Date.now(),
      userId,
      userEmail,
      isAuthenticated: true,
    });

    // Return a successful response
    return createResponse(200, { message: "Connected" });
  } catch (error) {
    console.error("Error handling connect event:", error);
    return createResponse(500, { message: "Internal Server Error" });
  }
};
