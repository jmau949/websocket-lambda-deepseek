/**
 * Local WebSocket Server for Development
 */
import "dotenv/config";
import fastify from "fastify";
import WebSocket, { Server as WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";

// Create Fastify instance
const app = fastify({
  logger: {
    level: "info",
  },
});

// In-memory storage
const connections = new Map<string, any>();
const chatSessions = new Map<string, any>();
const sockets = new Map<string, WebSocket>();

// Import handlers
import { handler as connectHandler } from "./src/handlers/connect";
import { handler as disconnectHandler } from "./src/handlers/disconnect";
import { handler as messageHandler } from "./src/handlers/message";
import { handler as defaultHandler } from "./src/handlers/default";

// Mock AWS SDK calls
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

// Debug helper to print the current state
function debugState() {
  console.log("\n--- DEBUG STATE ---");
  console.log("Connections:", connections.size);
  console.log("Chat Sessions:", chatSessions.size);
  console.log("WebSockets:", sockets.size);
  console.log("Chat Sessions Map:", 
    Array.from(chatSessions.keys()).map(k => `${k.substring(0, 8)}...`)
  );
  console.log("------------------\n");
}

// Override DynamoDB client to log all operations
DynamoDBClient.prototype.send = async function (command) {
  console.log("Mock DynamoDB client command:", command.constructor.name);
  return {};
};

// Override DynamoDB operations
DynamoDBDocumentClient.prototype.send = async function (command) {
  // Connection table operations
  if (command instanceof PutCommand) {
    const item = command.input.Item;
    const tableName = command.input.TableName;
    
    console.log(`PutCommand for table: ${tableName}`);
    
    if (tableName === process.env.CONNECTIONS_TABLE || tableName?.toLowerCase().includes("connection")) {
      console.log(`Saving connection: ${item?.connectionId}`);
      connections.set(item?.connectionId, item);
    } else if (tableName === process.env.CHAT_SESSIONS_TABLE || tableName?.toLowerCase().includes("chat")) {
      console.log(`Saving chat session: ${item?.connectionId}`);
      chatSessions.set(item?.connectionId, item);
      debugState();
    }
    return {};
  }

  if (command instanceof GetCommand) {
    const key = command.input.Key?.connectionId;
    const tableName = command.input.TableName;
    
    console.log(`GetCommand for table: ${tableName}, key: ${key}`);
    
    if (tableName === process.env.CONNECTIONS_TABLE || tableName?.toLowerCase().includes("connection")) {
      const connection = connections.get(key);
      console.log(`Retrieved connection: ${key}`, connection ? "Found" : "Not found");
      return { Item: connection };
    } else if (tableName === process.env.CHAT_SESSIONS_TABLE || tableName?.toLowerCase().includes("chat")) {
      const session = chatSessions.get(key);
      console.log(`Retrieved chat session: ${key}`, session ? "Found" : "Not found");
      debugState();
      return { Item: session };
    }
    return { Item: null };
  }

  if (command instanceof DeleteCommand) {
    const key = command.input.Key?.connectionId;
    const tableName = command.input.TableName;
    
    console.log(`DeleteCommand for table: ${tableName}, key: ${key}`);
    
    if (tableName === process.env.CONNECTIONS_TABLE || tableName?.toLowerCase().includes("connection")) {
      connections.delete(key);
      console.log(`Deleted connection: ${key}`);
    } else if (tableName === process.env.CHAT_SESSIONS_TABLE || tableName?.toLowerCase().includes("chat")) {
      chatSessions.delete(key);
      console.log(`Deleted chat session: ${key}`);
      debugState();
    }
    return {};
  }

  if (command instanceof UpdateCommand) {
    const key = command.input.Key?.connectionId;
    const tableName = command.input.TableName;
    
    console.log(`UpdateCommand for table: ${tableName}, key: ${key}`);
    console.log(`UpdateExpression: ${command.input.UpdateExpression}`);
    
    if (tableName === process.env.CHAT_SESSIONS_TABLE || tableName?.toLowerCase().includes("chat")) {
      const session = chatSessions.get(key);
      if (session) {
        console.log(`Found chat session for update: ${key}`);
        if (command.input.UpdateExpression?.includes("conversationHistory")) {
          console.log("Updating conversation history");
          session.conversationHistory = command.input.ExpressionAttributeValues?.[":history"];
          session.updatedAt = command.input.ExpressionAttributeValues?.[":updatedAt"];
        } else if (command.input.UpdateExpression?.includes("empty")) {
          console.log("Clearing conversation history");
          session.conversationHistory = [];
          session.updatedAt = command.input.ExpressionAttributeValues?.[":updatedAt"];
        }
        chatSessions.set(key, session);
        debugState();
        return { Attributes: session };
      } else {
        console.log(`Chat session not found for update: ${key}`);
        return {};
      }
    }
    return {};
  }
  
  if (command instanceof QueryCommand) {
    console.log(`QueryCommand for table: ${command.input.TableName}`);
    console.log(`IndexName: ${command.input.IndexName}`);
    console.log(`KeyConditionExpression: ${command.input.KeyConditionExpression}`);
    return { Items: [] };
  }

  console.log(`Unhandled command type: ${command.constructor.name}`);
  return {};
};

// Override API Gateway Management API
ApiGatewayManagementApiClient.prototype.send = async function (command) {
  if (command instanceof PostToConnectionCommand) {
    const connectionId = command.input.ConnectionId;
    const data = command.input.Data;
    const socket = sockets.get(connectionId as string);

    if (socket && socket.readyState === WebSocket.OPEN) {
      const dataString = Buffer.isBuffer(data) 
        ? data.toString() 
        : typeof data === 'string' 
          ? data 
          : JSON.stringify(data);
          
      socket.send(dataString);
    } else {
      throw { name: "GoneException" };
    }
  }

  return {};
};

// Make environment variables available
console.log("Environment variables:");
console.log("CONNECTIONS_TABLE:", process.env.CONNECTIONS_TABLE);
console.log("CHAT_SESSIONS_TABLE:", process.env.CHAT_SESSIONS_TABLE);

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Create API Gateway event object
function createApiGatewayEvent(
  routeKey: string, 
  connectionId: string, 
  body?: string
): any {  // Using any to avoid TypeScript errors with AWS types
  return {
    requestContext: {
      connectionId,
      routeKey,
      domainName: "localhost",
      stage: "local",
      apiId: "local",
      extendedRequestId: uuidv4(),  // Required by the type
      authorizer: {
        userId: `user-${connectionId.substring(0, 8)}`,
        email: `user-${connectionId.substring(0, 6)}@example.com`,
      },
      messageId: uuidv4(),
      eventType: "MESSAGE",
      messageDirection: "IN",
      connectedAt: Date.now(),
      requestTimeEpoch: Date.now(),
      requestId: uuidv4(),
      identity: {
        sourceIp: "127.0.0.1",
      },
      requestTime: new Date().toISOString()
    },
    body: body || "",
    isBase64Encoded: false
  };
}

// Handle WebSocket upgrade
app.server?.on("upgrade", (request, socket, head) => {
  const connectionId = uuidv4();
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, connectionId);
  });
});

// Handle WebSocket connections
wss.on("connection", async (ws: WebSocket, connectionId: string) => {
  console.log(`New connection: ${connectionId}`);
  sockets.set(connectionId, ws);

  try {
    // Handle connect
    await connectHandler(createApiGatewayEvent("$connect", connectionId));

    // Manually create a chat session if needed
    if (!chatSessions.has(connectionId)) {
      console.log("Manually creating chat session");
      const userId = `user-${connectionId.substring(0, 8)}`;
      const timestamp = Date.now();
      chatSessions.set(connectionId, {
        connectionId,
        userId,
        conversationHistory: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ttl: Math.floor(timestamp / 1000) + 14400 // 4 hours
      });
      debugState();
    }

    // Handle messages
    ws.on("message", async (data) => {
      try {
        const dataString = data.toString();
        console.log(`Received message: ${dataString.substring(0, 100)}...`);
        
        let message;
        try {
          message = JSON.parse(dataString);
        } catch (e) {
          console.log("Failed to parse message as JSON, using default action");
          message = { action: "$default" };
        }

        const event = createApiGatewayEvent(
          message.action || "$default",
          connectionId,
          dataString
        );

        if (message.action === "message") {
          await messageHandler(event);
        } else {
          await defaultHandler(event);
        }
      } catch (error) {
        console.error("Message error:", error);
      }
    });

    // Handle disconnect
    ws.on("close", async () => {
      console.log(`Connection closed: ${connectionId}`);
      await disconnectHandler(createApiGatewayEvent("$disconnect", connectionId));
      sockets.delete(connectionId);
      debugState();
    });

    // Welcome message
    ws.send(JSON.stringify({ 
      message: "Connected", 
      connectionId 
    }));
  } catch (error) {
    console.error("Connection error:", error);
    ws.close();
  }
});

// HTTP routes
app.get("/", (_, reply) => {
  reply.send({
    message: "WebSocket server running",
    connections: connections.size,
    chatSessions: chatSessions.size
  });
});

// Debug endpoint for chat sessions
app.get("/debug/sessions", (_, reply) => {
  const simplifiedSessions = Array.from(chatSessions.entries()).map(([id, session]) => ({
    id,
    userId: session.userId,
    messagesCount: session.conversationHistory?.length || 0,
    lastMessage: session.conversationHistory?.length > 0 
      ? session.conversationHistory[session.conversationHistory.length - 1].content.substring(0, 50) 
      : 'None',
    session: session // Include the full session for debugging
  }));
  
  reply.send({
    count: chatSessions.size,
    sessions: simplifiedSessions
  });
});

// Endpoint to manually add a test message to a session
app.get("/debug/add-test-message/:connectionId", (request, reply) => {
  const params = request.params as { connectionId: string };
  const session = chatSessions.get(params.connectionId);
  
  if (!session) {
    reply.status(404).send({ error: "Chat session not found" });
    return;
  }
  
  if (!session.conversationHistory) {
    session.conversationHistory = [];
  }
  
  session.conversationHistory.push({
    role: "user",
    content: "This is a test message",
    timestamp: Date.now()
  });
  
  session.updatedAt = Date.now();
  chatSessions.set(params.connectionId, session);
  
  reply.send({
    message: "Test message added",
    session
  });
});

// Start server
const start = async () => {
  try {
    await app.listen({ port: 3000, host: "0.0.0.0" });
    console.log("Server running at http://localhost:3000");
    console.log("WebSocket server at ws://localhost:3000");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();