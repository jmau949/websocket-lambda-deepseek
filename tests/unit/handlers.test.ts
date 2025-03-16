import { handler as connectHandler } from "../../src/handlers/connect";
import { handler as disconnectHandler } from "../../src/handlers/disconnect";
import { handler as messageHandler } from "../../src/handlers/message";
import { handler as defaultHandler } from "../../src/handlers/default";

// Mock AWS SDK clients
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: jest
        .fn()
        .mockResolvedValue({ Item: { connectionId: "test-connection-id" } }),
    })),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));

jest.mock("@aws-sdk/client-apigatewaymanagementapi", () => ({
  ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PostToConnectionCommand: jest.fn(),
}));

describe("WebSocket Handlers", () => {
  const mockEvent = {
    requestContext: {
      connectionId: "test-connection-id",
      domainName: "test-domain.execute-api.us-east-1.amazonaws.com",
      stage: "dev",
      routeKey: "test-route",
    },
    body: JSON.stringify({
      action: "message",
      data: "Test message",
    }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("Connect handler should return 200 status code", async () => {
    const response = await connectHandler(mockEvent);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty("message", "Connected");
  });

  test("Disconnect handler should return 200 status code", async () => {
    const response = await disconnectHandler(mockEvent);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty("message", "Disconnected");
  });

  test("Message handler should return 200 status code", async () => {
    const response = await messageHandler(mockEvent);
    expect(response.statusCode).toBe(200);
  });

  test("Default handler should return 200 status code", async () => {
    const response = await defaultHandler(mockEvent);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty("message");
  });
});
