import {
  APIGatewayProxyResult,
  APIGatewayProxyEvent,
  APIGatewayProxyWebsocketEventV2,
} from "aws-lambda";

/**
 * Helper function to create a standard API Gateway response
 */
export const createResponse = (
  statusCode: number,
  body: any
): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(body),
  };
};

/**
 * Parse and validate WebSocket message
 */
export const parseWebSocketEvent = (
  event: APIGatewayProxyWebsocketEventV2
): any => {
  if (!event.body) {
    return { action: "$default" };
  }

  try {
    return JSON.parse(event.body);
  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
    return { action: "$default" };
  }
};

/**
 * Extract connection details from API Gateway event
 */
export const extractConnectionInfo = (
  event: APIGatewayProxyWebsocketEventV2
) => {
  const connectionId = event.requestContext.connectionId;
  const domainName = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const apiId = event.requestContext.apiId;
  // Get region from Lambda environment or from the event context
  const region = process.env.AWS_REGION || "us-west-2"; // Default to us-west-2 if not available

  console.log("Extracted connection info:", {
    connectionId,
    domainName,
    stage,
    apiId,
    region,
  });

  return { connectionId, domainName, stage, apiId, region };
};
