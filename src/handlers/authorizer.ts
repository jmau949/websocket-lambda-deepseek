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
  methodArn: string,
  context: Record<string, any> = {}
): APIGatewayAuthorizerResult => {
  // Extract the API ID, region, and account ID from the methodArn
  const arnParts = methodArn.split(":");
  const apiGatewayArnTmp = arnParts[5].split("/");
  const awsAccountId = arnParts[4];
  const region = arnParts[3];
  const apiId = apiGatewayArnTmp[0];
  const stage = apiGatewayArnTmp[1];

  // Create a wildcard resource for WebSocket connections
  // This is critical for WebSocket APIs to allow all operations (connect, message, disconnect)
  const resource = `arn:aws:execute-api:${region}:${awsAccountId}:${apiId}/${stage}/*`;

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

  console.log(`Generated policy with resource: ${resource}`);

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

    // Check Origin header for allowed domains
    const origin = event.headers?.origin || "";
    console.log("Origin header:", origin);

    // Define allowed origins - only jonathanmau.com domains
    const allowedOrigins = [
      "https://jonathanmau.com",
      "https://ai.jonathanmau.com",
      "https://ws.jonathanmau.com",
    ];

    // Check if origin is allowed - strict jonathanmau.com domains only
    const isOriginAllowed = allowedOrigins.some((allowedOrigin) =>
      origin.startsWith(allowedOrigin)
    );

    if (origin && !isOriginAllowed) {
      console.log(`Origin not allowed: ${origin}`);
      return generatePolicy("anonymous", "Deny", methodArn);
    }

    // Extract token from Cookie header
    const cookieHeader = event.headers?.Cookie || "";
    console.log("Cookie header:", cookieHeader);

    // More robust cookie parsing
    const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
      const [name, value] = cookie.trim().split("=");
      if (name && value) acc[name] = value;
      return acc;
    }, {} as Record<string, string>);

    const accessToken = cookies.authToken;

    if (!accessToken) {
      console.log("No auth token found in cookies");
      return generatePolicy("anonymous", "Deny", methodArn);
    }

    // Verify the token with Cognito
    const userData = await verifyAccessToken(accessToken);

    if (!userData) {
      console.log("Invalid or expired token");
      return generatePolicy("anonymous", "Deny", methodArn);
    }

    // Extract user details
    const userId = userData.sub;
    const email = userData.email || "";
    const groups = userData["cognito:groups"] || [];

    console.log("User authenticated:", { userId, email });

    // Generate policy allowing access with user context
    const result = generatePolicy(userId, "Allow", methodArn, {
      userId,
      email,
      groups: JSON.stringify(groups),
      origin,
    });

    console.log("Authorization result:", JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("Authorization error:", error);

    // Deny by default in case of any errors
    return generatePolicy("anonymous", "Deny", event.methodArn);
  }
};