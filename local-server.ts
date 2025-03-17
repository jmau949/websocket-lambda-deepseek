/**
 * Local WebSocket Server for Development
 *
 * This server replicates an AWS API Gateway WebSocket setup for local development.
 * Authentication and authorization removed as requested.
 */
import "dotenv/config";
import fastify from "fastify";
import WebSocket, { Server as WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import * as url from "url";

// Create Fastify instance
const app = fastify({
  logger: {
    level: "info",
  },
});

// In-memory connection storage
const connections = new Map<string, any>();
const sockets = new Map<string, WebSocket>();

// Import the WebSocket handlers
import { handler as connectHandler } from "./src/handlers/connect";
import { handler as disconnectHandler } from "./src/handlers/disconnect";
import { handler as messageHandler } from "./src/handlers/message";
import { handler as defaultHandler } from "./src/handlers/default";

// Override AWS SDK functions with local implementations
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

// Create a proxy for DynamoDB client
DynamoDBClient.prototype.send = async function (command) {
  console.log("Mock DynamoDB command:", command.constructor.name);
  return {};
};

// Create proxies for DynamoDB document client operations
DynamoDBDocumentClient.prototype.send = async function (command) {
  console.log("Mock DynamoDB Document command:", command.constructor.name);

  if (command instanceof PutCommand) {
    const item = command.input.Item;
    connections.set(item?.connectionId, item);
    console.log(`Saved connection: ${item?.connectionId}`);
    return {};
  }

  if (command instanceof GetCommand) {
    const connectionId = command.input.Key?.connectionId;
    const connection = connections.get(connectionId);
    console.log(
      `Retrieved connection: ${connectionId}`,
      connection ? "Found" : "Not found"
    );
    return { Item: connection };
  }

  if (command instanceof DeleteCommand) {
    const connectionId = command.input.Key?.connectionId;
    connections.delete(connectionId);
    console.log(`Deleted connection: ${connectionId}`);
    return {};
  }

  return {};
};

// Create a proxy for API Gateway Management API
ApiGatewayManagementApiClient.prototype.send = async function (command) {
  if (command instanceof PostToConnectionCommand) {
    const connectionId = command.input.ConnectionId;
    const data = command.input.Data;
    const socket = sockets.get(connectionId as string);

    if (socket && socket.readyState === WebSocket.OPEN) {
      console.log(`Sending message to connection: ${connectionId}`);
      //@ts-ignore
      socket.send(Buffer.isBuffer(data) ? data.toString() : data);
    } else {
      console.log(`Connection not found or closed: ${connectionId}`);
      throw { name: "GoneException" };
    }
  }

  return {};
};

// WebSocket server
const wss = new (WebSocket as any).Server({ noServer: true });

/**
 * Creates a mock API Gateway WebSocket event object
 */
function createApiGatewayEvent(
  routeKey: string,
  connectionId: string,
  body?: string
): any {
  return {
    requestContext: {
      connectionId,
      routeKey,
      domainName: "localhost",
      stage: "local",
      identity: {
        sourceIp: "127.0.0.1",
      },
      requestTimeEpoch: Date.now()
    },
    isBase64Encoded: false,
    body,
  };
}

// Handle upgrade requests (WebSocket connection initiation)
app.server?.on("upgrade", async (request: any, socket: any, head: any) => {
  try {
    // Generate a connection ID
    const connectionId = uuidv4();
    
    // Proceed with WebSocket upgrade
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      // Emit connection event with the connection ID
      wss.emit("connection", ws, connectionId);
    });
  } catch (error) {
    console.error("Error handling WebSocket upgrade:", error);
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

// Handle WebSocket connections
wss.on("connection", async (ws: WebSocket, connectionId: string) => {
  console.log(`New WebSocket connection: ${connectionId}`);

  // Store WebSocket instance
  sockets.set(connectionId, ws);

  try {
    // Create a connect event
    const connectEvent = createApiGatewayEvent(
      "$connect",
      connectionId
    );

    // Call the connect handler
    await connectHandler(connectEvent);

    // Handle incoming messages
    ws.addEventListener("message", async (event) => {
      try {
        const messageData = event.data;
        console.log(`Received message from ${connectionId}:`, messageData);

        // Parse the message
        let parsedMessage;
        try {
          parsedMessage = JSON.parse(messageData as any);
        } catch (error) {
          parsedMessage = { action: "$default" };
        }

        // Create the API Gateway event
        const messageEvent = createApiGatewayEvent(
          parsedMessage.action || "$default",
          connectionId,
          messageData as any
        );

        // Route to the appropriate handler
        if (parsedMessage.action === "message") {
          await messageHandler(messageEvent);
        } else {
          await defaultHandler(messageEvent);
        }
      } catch (error) {
        console.error("Error processing message:", error);
        ws.send(
          JSON.stringify({
            error: "Error processing message",
            message: "Failed to process your request",
          })
        );
      }
    });

    // Handle disconnection
    ws.addEventListener("close", async () => {
      console.log(`Connection closed: ${connectionId}`);

      // Call disconnect handler
      const disconnectEvent = createApiGatewayEvent(
        "$disconnect",
        connectionId
      );
      await disconnectHandler(disconnectEvent);

      // Clean up
      sockets.delete(connectionId);
    });

    // Send welcome message
    ws.send(
      JSON.stringify({
        message: "Connected to WebSocket server",
        connectionId,
      })
    );
  } catch (error) {
    console.error("Error handling connection:", error);
    ws.close();
  }
});

// HTTP routes
app.get("/", (request, reply) => {
  reply.send({
    message: "WebSocket server is running",
    activeConnections: connections.size,
  });
});

// Start the server
const start = async () => {
  try {
    const server = await app.listen({ port: 3000, host: "0.0.0.0" });
    console.log(`Server is running at ${server}`);
    console.log(`WebSocket server is running at ws://localhost:3000`);
    console.log(`Authentication and authorization have been removed`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Start the server
start();