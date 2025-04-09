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

  // First check if session already exists to prevent duplication
  const existingSession = await getChatSession(connectionId);
  if (existingSession) {
    console.log(
      `Chat session already exists for connection ${connectionId}, returning existing session`
    );
    return existingSession;
  }

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
    console.log(`Getting chat session for connectionId: ${connectionId}`);
    const { Item } = await docClient.send(new GetCommand(params));
    const found = Item ? true : false;
    console.log(
      `Chat session ${found ? "found" : "not found"} for ${connectionId}`
    );
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

    // If session doesn't exist, we can't add a message
    // The caller should handle this by creating a session first
    if (!session) {
      console.log(
        `Chat session not found for ${connectionId}, cannot add message`
      );
      return null;
    }

    // Make sure conversationHistory is initialized
    if (!session.conversationHistory) {
      session.conversationHistory = [];
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
      ReturnValues: "ALL_NEW" as const,
    };

    console.log(`Updating chat session with new message for ${connectionId}`);
    const result = await docClient.send(new UpdateCommand(params));
    console.log(`Message added to chat session ${connectionId}`);
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
    // First check if the session exists
    const session = await getChatSession(connectionId);
    if (!session) {
      console.log(
        `Chat session not found for ${connectionId}, cannot clear history`
      );
      return;
    }

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