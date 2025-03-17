import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
  PolicyDocument,
  Statement,
} from "aws-lambda";
import { verifyAccessToken } from "../services/cognito.service";

/**
 * Generate IAM policy for API Gateway authorization
 *
 * @param principalId - The principal ID (usually user ID)
 * @param effect - The effect (Allow/Deny)
 * @param resource - The API Gateway resource ARN
 * @param context - Additional context to pass to downstream functions
 * @returns The authorization response for API Gateway
 */
const generatePolicy = (
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
  context: Record<string, any> = {}
): APIGatewayAuthorizerResult => {
  // Create policy document
  const policyDocument: PolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Action: "execute-api:Invoke",
        Effect: effect,
        Resource: resource,
      } as Statement,
    ],
  };

  // Return complete authorization response
  return {
    principalId,
    policyDocument,
    context,
  };
};

/**
 * WebSocket API authorizer handler
 *
 * This Lambda validates the Cognito access token from the Cookie header
 * and generates an IAM policy allowing or denying access to the WebSocket API.
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  try {
    console.log("Authorizer event:", JSON.stringify(event, null, 2));

    // Get the API Gateway resource ARN
    const methodArn = event.methodArn;

    // Extract token from Cookie header
    const cookieHeader = event.headers?.Cookie || "";
    const tokenCookie = cookieHeader
      .split(";")
      .find((cookie) => cookie.trim().startsWith("authToken="));

    if (!tokenCookie) {
      console.log("No token cookie found");
      return generatePolicy("user", "Deny", methodArn);
    }

    const accessToken = tokenCookie.split("=")[1].trim();

    // Verify the token with Cognito
    const userData = await verifyAccessToken(accessToken);

    if (!userData) {
      console.log("Invalid or expired token");
      return generatePolicy("user", "Deny", methodArn);
    }

    // Extract user details
    const userId = userData.sub;
    const email = userData.email || "";
    const groups = userData["cognito:groups"] || [];

    console.log("User authenticated:", { userId, email });

    // Generate policy allowing access with user context
    return generatePolicy(userId, "Allow", methodArn, {
      userId,
      email,
      groups: JSON.stringify(groups),
    });
  } catch (error) {
    console.error("Authorization error:", error);

    // Deny by default in case of any errors
    return generatePolicy("user", "Deny", event.methodArn);
  }
};