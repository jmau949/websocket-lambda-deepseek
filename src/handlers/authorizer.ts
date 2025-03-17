import {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayAuthorizerResult,
} from "aws-lambda";
import { verifyAccessToken } from "../services/cognito.service";

/**
 * Type imports from AWS Lambda for policy document
 */
import { Statement, PolicyDocument } from "aws-lambda";

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
 * This Lambda validates the Cognito access token from the query parameter
 * and generates an IAM policy allowing or denying access to the WebSocket API.
 */
export const handler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  try {
    console.log("Authorizer event:", JSON.stringify(event, null, 2));

    // Get the API Gateway resource ARN
    const methodArn = event.methodArn;

    // Extract token from query parameters
    const queryParams = event.queryStringParameters || {};
    const accessToken = queryParams.authToken;

    if (!accessToken) {
      console.log("No auth token found in query parameters");
      return generatePolicy("user", "Deny", methodArn);
    }

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