import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "../config/config";

export interface Connection {
  connectionId: string;
  timestamp: number;
  domainName?: string;
  stage?: string;
  userId?: string;
  userEmail?: string;
  ttl?: number;
  isAuthenticated?: boolean;
}

// Create DynamoDB clients
const client = new DynamoDBClient({ region: config.region });
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Add a new WebSocket connection to DynamoDB
 */
export const saveConnection = async (connection: Connection): Promise<void> => {
  const timestamp = Date.now();
  const ttl = Math.floor(timestamp / 1000) + config.connectionTtl;

  const params = {
    TableName: config.connectionsTable,
    Item: {
      ...connection,
      timestamp,
      ttl,
    },
  };

  try {
    await docClient.send(new PutCommand(params));
    console.log(`Connection ${connection.connectionId} saved`);
  } catch (error) {
    console.error("Error saving connection:", error);
    throw error;
  }
};

/**
 * Get a connection from DynamoDB by connectionId
 */
export const getConnection = async (
  connectionId: string
): Promise<Connection | null> => {
  const params = {
    TableName: config.connectionsTable,
    Key: {
      connectionId,
    },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    return (Item as Connection) || null;
  } catch (error) {
    console.error("Error getting connection:", error);
    throw error;
  }
};

/**
 * Delete a connection from DynamoDB
 */
export const deleteConnection = async (connectionId: string): Promise<void> => {
  const params = {
    TableName: config.connectionsTable,
    Key: {
      connectionId,
    },
  };

  try {
    await docClient.send(new DeleteCommand(params));
    console.log(`Connection ${connectionId} deleted`);
  } catch (error) {
    console.error("Error deleting connection:", error);
    throw error;
  }
};

/**
 * Get all connections for a specific user
 */
export const getConnectionsByUserId = async (
  userId: string
): Promise<Connection[]> => {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: config.connectionsTable,
        IndexName: "UserIdIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      console.log(`No connections found for user ${userId}`);
      return [];
    }

    return result.Items as Connection[];
  } catch (error) {
    console.error(`Error retrieving connections for user ${userId}:`, error);
    return [];
  }
};