import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { config } from '../config/config';

/**
 * Create an instance of the API Gateway Management API client
 */
export const createApiGatewayClient = (endpoint: string): ApiGatewayManagementApiClient => {
  return new ApiGatewayManagementApiClient({
    region: config.region,
    endpoint,
  });
};

/**
 * Send a message to a connected WebSocket client
 */
export const sendMessageToClient = async (
  client: ApiGatewayManagementApiClient,
  connectionId: string,
  payload: any
): Promise<void> => {
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload)),
    });

    await client.send(command);
    console.log(`Message sent to connection ${connectionId}`);
  } catch (error: any) {
    if (error.name === 'GoneException') {
      console.log(`Connection ${connectionId} is gone`);
      // You could delete the connection from DynamoDB here
    } else {
      console.error(`Error sending message to connection ${connectionId}:`, error);
      throw error;
    }
  }
};

/**
 * Generate API Gateway WebSocket endpoint URL
 */
export const getWebSocketEndpoint = (domainName: string, stage: string): string => {
  return `https://${domainName}/${stage}`;
};