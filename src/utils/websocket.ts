import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { config } from "../config/config";

/**
 * Get the WebSocket API endpoint based on domain name, API ID, and stage
 *
 * For custom domains, we use the domain name directly
 * For default API Gateway URLs, we construct the URL with the API ID, region, and stage
 */
export const getWebSocketEndpoint = (
  domainName: string,
  stage: string,
  apiId?: string,
  region?: string
): string => {
  if (!domainName) {
    throw new Error(
      "Domain name is required to construct the WebSocket endpoint"
    );
  }

  const regionToUse = region || config.region;

  // For custom domains (doesn't contain execute-api), don't append the stage
  if (!domainName.includes(".execute-api.")) {
    console.log(`Using custom domain endpoint: https://${domainName}`);
    return `https://${domainName}`;
  }

  // For default API Gateway URLs, we need to ensure we have the correct format
  // Either use the domain name directly if it's already in the right format
  if (domainName.includes(`.execute-api.${regionToUse}.amazonaws.com`)) {
    console.log(
      `Using default API Gateway endpoint with domain: https://${domainName}/${stage}`
    );
    return `https://${domainName}/${stage}`;
  }

  // Otherwise, construct the URL using API ID and region
  if (apiId && regionToUse) {
    const endpoint = `https://${apiId}.execute-api.${regionToUse}.amazonaws.com/${stage}`;
    console.log(`Using constructed API Gateway endpoint: ${endpoint}`);
    return endpoint;
  }

  // Fallback to using the domain name and stage
  console.log(`Using fallback endpoint: https://${domainName}/${stage}`);
  return `https://${domainName}/${stage}`;
};

/**
 * Create API Gateway Management API client
 */
export const createApiGatewayClient = (
  endpoint: string
): ApiGatewayManagementApiClient => {
  console.log("Creating API Gateway client with endpoint:", endpoint);
  return new ApiGatewayManagementApiClient({
    endpoint,
    region: config.region,
  });
};

/**
 * Send message to WebSocket client
 */
export const sendMessageToClient = async (
  apiGatewayClient: ApiGatewayManagementApiClient,
  connectionId: string,
  data: any
): Promise<void> => {
  try {
    console.log(`Attempting to send message to connection ${connectionId}`);

    // Convert data to string if it's not already a string
    const dataString = typeof data === "string" ? data : JSON.stringify(data);

    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(dataString),
    });

    await apiGatewayClient.send(command);
    console.log(`Message successfully sent to connection ${connectionId}`);
  } catch (error) {
    console.error(
      `Error sending message to connection ${connectionId}:`,
      error
    );

    // If the connection is gone, we can delete it
    if (
      (error as { name?: string }).name === "GoneException" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 410
    ) {
      console.log(
        `Connection ${connectionId} is gone, would delete from database here`
      );
      // Implementation to delete connection from database would go here
    }
    throw error;
  }
};

/**
 * Delete a WebSocket connection
 */
export const deleteConnection = async (
  apiGatewayClient: ApiGatewayManagementApiClient,
  connectionId: string
): Promise<void> => {
  try {
    const command = new DeleteConnectionCommand({
      ConnectionId: connectionId,
    });

    await apiGatewayClient.send(command);
    console.log(`Connection ${connectionId} deleted`);
  } catch (error) {
    console.error(`Error deleting connection ${connectionId}:`, error);
    throw error;
  }
};
