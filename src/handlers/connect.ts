import {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResult,
} from "aws-lambda";
import { extractConnectionInfo, createResponse } from "../utils/lambda";
import { saveConnection } from "../services/connection.service";
import { createChatSession } from "../services/chat-session.service";

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
    const connectionInfo = extractConnectionInfo(event);

    // Type assertions to ensure TypeScript treats these as non-optional strings
    const connectionId = connectionInfo.connectionId as string;
    const domainName = connectionInfo.domainName as string;
    const stage = connectionInfo.stage as string;

    // Extract origin header for additional validation
    // TypeScript typings for WebSocket events can be incomplete, use type assertion
    const headers = (event as any).headers || {};
    const origin = headers.origin || headers.Origin || "";
    console.log("Origin header:", origin);

    // Define allowed origins - only jonathanmau.com domains
    const allowedOrigins = [
      "https://jonathanmau.com",
      "https://ai.jonathanmau.com",
      "https://ws.jonathanmau.com",
      "https://www.ai.jonathanmau.com",
    ];

    // Check if origin is allowed - only jonathanmau.com domains
    const isOriginAllowed = allowedOrigins.some((allowedOrigin) =>
      origin.startsWith(allowedOrigin)
    );

    if (origin && !isOriginAllowed) {
      console.log(`Origin not allowed: ${origin}`);
      return createResponse(403, { message: "Origin not allowed" });
    }

    // Extract user details from the authorizer context
    // Cast to any to access the authorizer property
    const requestContext = event.requestContext as any;
    const authorizer = requestContext.authorizer || {};

    // Get user identity from authorizer context, ensuring a non-empty value
    const userId = (authorizer.userId ||
      authorizer.principalId ||
      "anonymous") as string;
    const userEmail = (authorizer.email || "") as string;

    console.log("Authenticated user:", { userId, userEmail });

    // Save the connection to DynamoDB with user info
    await saveConnection({
      connectionId,
      domainName,
      stage,
      timestamp: Date.now(),
      userId,
      userEmail,
      isAuthenticated: true,
      origin, // Store the origin for auditing/debugging
    });

    // Create a new chat session for this connection
    try {
      await createChatSession(connectionId, userId);
      console.log(`Chat session created for connection ${connectionId}`);
    } catch (error) {
      // Log error but continue with connection process
      console.error("Error creating chat session:", error);
    }

    // Return a successful response
    return createResponse(200, { message: "Connected" });
  } catch (error) {
    console.error("Error handling connect event:", error);
    return createResponse(500, { message: "Internal Server Error" });
  }
};