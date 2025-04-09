import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { config } from "../config/config";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  connectionId: string;
  userId: string;
  conversationHistory: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  ttl?: number;
}

// Create DynamoDB clients
const client = new DynamoDBClient({ region: config.region });
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Create a new chat session for a connection
 */
export const createChatSession = async (
  connectionId: string,
  userId: string
): Promise<ChatSession> => {
  const timestamp = Date.now();
  const ttl = Math.floor(timestamp / 1000) + config.chatSessionTtl;

  const session: ChatSession = {
    connectionId,
    userId,
    conversationHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ttl,
  };

  const params = {
    TableName: config.chatSessionsTable,
    Item: session,
  };

  try {
    await docClient.send(new PutCommand(params));
    console.log(`Chat session created for connection ${connectionId}`);
    return session;
  } catch (error) {
    console.error("Error creating chat session:", error);
    throw error;
  }
};

/**
 * Get a chat session by connectionId
 */
export const getChatSession = async (
  connectionId: string
): Promise<ChatSession | null> => {
  const params = {
    TableName: config.chatSessionsTable,
    Key: {
      connectionId,
    },
  };

  try {
    const { Item } = await docClient.send(new GetCommand(params));
    return (Item as ChatSession) || null;
  } catch (error) {
    console.error("Error getting chat session:", error);
    throw error;
  }
};

/**
 * Add a message to the chat session history
 */
export const addMessageToChatSession = async (
  connectionId: string,
  message: ChatMessage
): Promise<ChatSession | null> => {
  try {
    // First, check if the session exists
    let session = await getChatSession(connectionId);

    // If session doesn't exist, create a new one (need userId though)
    if (!session) {
      console.log(
        `Chat session not found for ${connectionId}, cannot add message`
      );
      return null;
    }

    const updatedSession = {
      ...session,
      conversationHistory: [...session.conversationHistory, message],
      updatedAt: Date.now(),
    };

    const params = {
      TableName: config.chatSessionsTable,
      Key: {
        connectionId,
      },
      UpdateExpression:
        "SET conversationHistory = :history, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":history": updatedSession.conversationHistory,
        ":updatedAt": updatedSession.updatedAt,
      },
      ReturnValues: "ALL_NEW" as const, // Fixed this line with type assertion
    };

    const result = await docClient.send(new UpdateCommand(params));
    return result.Attributes as ChatSession;
  } catch (error) {
    console.error("Error adding message to chat session:", error);
    throw error;
  }
};

/**
 * Clear the conversation history for a chat session
 */
export const clearChatSessionHistory = async (
  connectionId: string
): Promise<void> => {
  try {
    const params = {
      TableName: config.chatSessionsTable,
      Key: {
        connectionId,
      },
      UpdateExpression:
        "SET conversationHistory = :empty, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":empty": [],
        ":updatedAt": Date.now(),
      },
    };

    await docClient.send(new UpdateCommand(params));
    console.log(`Cleared chat history for connection ${connectionId}`);
  } catch (error) {
    console.error("Error clearing chat session history:", error);
    throw error;
  }
};

/**
 * Delete a chat session
 */
export const deleteChatSession = async (
  connectionId: string
): Promise<void> => {
  const params = {
    TableName: config.chatSessionsTable,
    Key: {
      connectionId,
    },
  };

  try {
    await docClient.send(new DeleteCommand(params));
    console.log(`Chat session ${connectionId} deleted`);
  } catch (error) {
    console.error("Error deleting chat session:", error);
    throw error;
  }
};
