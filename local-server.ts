/**
 * Local WebSocket Server for Development
 *
 * This server replicates an AWS API Gateway WebSocket setup for local development.
 * It handles authentication exactly like production, extracting JWT tokens from cookies.
 */
import "dotenv/config";
import fastify from "fastify";
import WebSocket, { Server as WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import * as jwt from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import cookie from "cookie";
console.log("process.env.AWS_REGION", process.env.AWS_REGION);
// Create Fastify instance
const app = fastify({
  logger: {
    level: "info",
  },
});

// In-memory connection storage
const connections = new Map<string, any>();
const sockets = new Map<string, WebSocket>();

// JWKS caching (24 hours)
let jwksCache: any = null;
let jwksLastFetch = 0;
const JWKS_CACHE_TTL = 24 * 60 * 60 * 1000;

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
    const socket = sockets.get(connectionId as any);

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
 * Fetch and cache JWKS from Cognito
 */
async function getJwks() {
  const now = Date.now();

  if (!jwksCache || now - jwksLastFetch > JWKS_CACHE_TTL) {
    try {
      const jwksUrl = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.AWS_COGNITO_USER_POOL_ID}/.well-known/jwks.json`;
      console.log(`Fetching JWKS from ${jwksUrl}`);

      const response = await axios.get(jwksUrl);
      jwksCache = response.data.keys;
      jwksLastFetch = now;
      console.log("JWKS fetched and cached successfully");
    } catch (error) {
      //   console.error("Error fetching JWKS:", error);
      throw new Error("Failed to retrieve JWKS");
    }
  }

  return jwksCache;
}

/**
 * Validate a JWT token against Cognito JWKS
 */
async function validateToken(token: string): Promise<any> {
  try {
    // Decode token header to get the key ID (kid)
    const decodedToken = jwt.decode(token, { complete: true });

    if (
      !decodedToken ||
      typeof decodedToken !== "object" ||
      !decodedToken.header ||
      !decodedToken.header.kid
    ) {
      throw new Error("Invalid token format");
    }

    // Get the key ID from token header
    const keyId = decodedToken.header.kid;

    // Get JWKS and find matching key
    const jwks = await getJwks();
    //@ts-ignore
    const matchingKey = jwks.find((key) => key.kid === keyId);

    if (!matchingKey) {
      throw new Error("No matching key found in JWKS");
    }

    // Convert JWK to PEM format
    const pem = jwkToPem(matchingKey);

    // Verify the token with the public key
    const verifiedToken = jwt.verify(token, pem, {
      issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.AWS_COGNITO_USER_POOL_ID}`,
      algorithms: ["RS256"],
    });

    return verifiedToken;
  } catch (error) {
    console.error("Token validation error:", error);
    throw new Error(
      `Invalid token: ${
        error instanceof Error ? error.message : "Verification failed"
      }`
    );
  }
}

/**
 * Extract token from WebSocket request cookie header
 * exactly as it would happen in production
 */
function extractTokenFromCookie(request: any): string | null {
  // Extract from Cookie header
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    // Parse cookies
    const cookies = cookie.parse(cookieHeader);
    console.log("cookies", cookies);

    // Look for the auth cookie (common name for JWT tokens)
    const token = cookies.authToken || cookies.id_token || cookies.token;
    if (token) {
      return token;
    }
  }

  return null;
}

/**
 * Creates a mock API Gateway WebSocket event object
 */
function createApiGatewayEvent(
  routeKey: string,
  connectionId: string,
  body?: string,
  claims?: any
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
      requestTimeEpoch: Date.now(),
      authorizer: claims
        ? {
            jwt: {
              claims,
            },
          }
        : undefined,
    },
    isBase64Encoded: false,
    body,
  };
}

// Handle upgrade requests (WebSocket connection initiation)
app.server?.on("upgrade", async (request, socket, head) => {
  try {
    // Extract token from cookie exactly like in production
    const token = extractTokenFromCookie(request);

    if (!token) {
      console.log("Authentication failed: No token found in cookies");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Validate the token
    let tokenClaims;
    try {
      tokenClaims = await validateToken(token);
      console.log("Token validated successfully:", tokenClaims.sub);
    } catch (error) {
      console.log("Authentication failed: Invalid token");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Generate a connection ID
    const connectionId = uuidv4();

    // Proceed with WebSocket upgrade
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      // Emit connection event with the connection ID and token claims
      wss.emit("connection", ws, connectionId, tokenClaims);
    });
  } catch (error) {
    console.error("Error handling WebSocket upgrade:", error);
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

// Handle WebSocket connections
wss.on(
  "connection",
  async (ws: WebSocket, connectionId: string, claims: any) => {
    console.log(`New WebSocket connection: ${connectionId}`);

    // Store WebSocket instance
    sockets.set(connectionId, ws);

    try {
      // Create a connect event with the user claims from the token
      const connectEvent = createApiGatewayEvent(
        "$connect",
        connectionId,
        undefined,
        claims
      );

      // Call the connect handler
      await connectHandler(connectEvent);

      // Handle incoming messages
      //@ts-ignore
      ws.addEventListener("message", async (event) => {
        try {
          const messageData = event.data as string;
          console.log(`Received message from ${connectionId}:`, messageData);

          // Parse the message
          let parsedMessage;
          try {
            parsedMessage = JSON.parse(messageData);
          } catch (error) {
            parsedMessage = { action: "$default" };
          }

          // Create the API Gateway event
          const messageEvent = createApiGatewayEvent(
            parsedMessage.action || "$default",
            connectionId,
            messageData,
            claims
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
          connectionId,
          undefined,
          claims
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
  }
);

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
    console.log(`Authentication: Using JWT token from HTTP-only cookies`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Start the server
start();
