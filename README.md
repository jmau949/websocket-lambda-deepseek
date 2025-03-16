
# AWS WebSocket Lambda API with Cognito Auth

A template repository for building real-time applications using AWS API Gateway WebSockets with Lambda integration and Cognito authentication.

## Architecture Overview

This template implements a secure WebSocket API using:

- **API Gateway WebSocket API**: Handles WebSocket connections
- **Cognito Authentication**: Validates JWT tokens via cookies
- **Lambda Functions**: Process WebSocket events
- **DynamoDB**: Stores active connections

### API Gateway WebSocket Flow

The request flow follows these steps:

1. **Connection Request**: Client initiates WebSocket connection with cookies
2. **Authorization**: API Gateway validates JWT token via Cognito authorizer
3. **Connection Establishment**: If authorized, $connect Lambda stores connection in DynamoDB
4. **Message Processing**: Subsequent messages are routed to appropriate Lambda handlers
5. **Response**: Lambda functions can send responses via the Management API
6. **Disconnection**: On disconnect, $disconnect Lambda cleans up connection data

## Project Structure

```
fastify-websocket-api/
├── src/
│   ├── handlers/      # Lambda handlers for WebSocket events
│   │   ├── connect.ts     # Handles new connections
│   │   ├── disconnect.ts  # Handles client disconnections
│   │   ├── message.ts     # Processes incoming messages
│   │   ├── default.ts     # Handles unrecognized message formats
│   │   └── index.ts       # Exports all handlers
│   ├── services/      # Business logic services
│   │   ├── auth.service.ts       # JWT validation with JWKS caching
│   │   ├── connection.service.ts # DynamoDB connection storage
│   │   └── message.service.ts    # Message processing logic
│   ├── models/        # Data models
│   │   ├── connection.model.ts   # Connection entity model
│   │   └── message.model.ts      # Message format definitions
│   ├── utils/         # Utility functions
│   │   ├── lambda.ts        # Lambda event helpers
│   │   └── websocket.ts     # WebSocket communication utilities
│   ├── config/        # Configuration
│   │   └── config.ts        # Environment & app configuration
│   └── index.ts       # Main entry point
├── local-server.ts    # Local development server
├── tests/             # Test files
├── template.yaml      # SAM template for AWS deployment
└── tsconfig.json      # TypeScript configuration
```

## Getting Started

### Prerequisites

1. AWS Account with appropriate permissions
2. AWS SAM CLI installed
3. Node.js 14+ and npm
4. A Cognito User Pool for authentication

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/fastify-websocket-api.git
cd fastify-websocket-api

# Install dependencies
npm install
```

### Configuration

1. Update Cognito settings in `src/config/config.ts`:

```typescript
export const config = {
  // DynamoDB
  connectionsTable: process.env.CONNECTIONS_TABLE || 'ConnectionsTable',
  
  // Connection TTL in seconds (default: 2 hours)
  connectionTtl: 7200,
  
  // AWS region
  region: process.env.AWS_REGION || 'us-east-1',

  // Authentication
  auth: {
    jwksCacheTTL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  },

  // Cognito configuration
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || '',
    clientId: process.env.COGNITO_CLIENT_ID || '',
  }
};
```

2. Update `template.yaml` with your Cognito User Pool details:

```yaml
Parameters:
  CognitoUserPoolId:
    Type: String
    Description: Cognito User Pool ID
    Default: ''
  
  CognitoClientId:
    Type: String
    Description: Cognito Client ID
    Default: ''
```

## Local Development

For local development, the project includes a WebSocket server that simulates API Gateway with Cognito authentication.

### Starting the Local Server

```bash
# First, update Cognito settings in local-server.ts
# Then run:
npm run local
```

The server will start at `ws://localhost:3000` and will:
- Extract JWT tokens from HTTP cookies (from the Cookie header)
- Validate tokens against your Cognito User Pool
- Process WebSocket events using your Lambda handlers
- Store connections in memory instead of DynamoDB

### Authentication

For local development:
- You need a valid JWT token in an HTTP-only cookie named `auth` or `id_token`
- The cookie must be set before connecting to the WebSocket
- The server validates this token against the same Cognito User Pool as production

### Testing with the Sample Client

A sample React chat application is included to test the WebSocket connection:

```bash
# In a separate terminal
cd client
npm install
npm start
```

## Deployment to AWS

### Build

```bash
# Compile TypeScript to JavaScript
npm run build
```

### Deploy with SAM

```bash
# Deploy to AWS
sam deploy --guided
```

During the guided deployment, you'll be prompted for:
- Stack name
- AWS Region
- Cognito User Pool ID
- Cognito App Client ID

### After Deployment

The SAM deployment will output:
- WebSocket URL
- Connections Table ARN

## Authentication Flow

### Client-Side Authentication

The client must authenticate with Cognito and store the JWT token in an HTTP-only cookie:

```javascript
// After authenticating with Cognito
document.cookie = `auth=${tokens.idToken}; path=/; secure; HttpOnly; SameSite=Strict`;
```

### Connection Process

1. Client initiates WebSocket connection
2. Browser automatically includes HTTP-only cookies
3. API Gateway extracts and validates the token
4. If valid, the $connect Lambda is invoked
5. $connect Lambda stores the connection in DynamoDB
6. Connection is established

### Security Notes

- Authentication happens at the connection level
- Once authenticated, the connectionId acts as a session identifier
- Message Lambdas don't need to re-validate tokens
- The connect handler stores user identity for authorization checks

## WebSocket API Usage

### Connection

Connect to the WebSocket API:

```javascript
const socket = new WebSocket('wss://your-api-id.execute-api.region.amazonaws.com/stage');
```

### Sending Messages

Send JSON messages with an `action` field to route the message:

```javascript
socket.send(JSON.stringify({
  action: 'message',
  data: {
    content: 'Hello world',
    recipient: 'all'
  }
}));
```

### Receiving Messages

```javascript
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

## Lambda Functions

### $connect Handler

- Validates the connection
- Extracts user information from Cognito claims
- Stores connection details in DynamoDB

### $disconnect Handler

- Cleans up the connection from DynamoDB
- Performs any necessary cleanup

### message Handler

- Processes incoming messages
- Can send responses to specific connections

### default Handler

- Handles messages with unknown actions
- Provides useful error feedback

## Monitoring and Debugging

### CloudWatch Logs

Each Lambda function logs to CloudWatch:

```
/aws/lambda/fastify-websocket-api-ConnectFunction-XXXX
/aws/lambda/fastify-websocket-api-DisconnectFunction-XXXX
/aws/lambda/fastify-websocket-api-MessageFunction-XXXX
/aws/lambda/fastify-websocket-api-DefaultFunction-XXXX
```

### API Gateway Logs

Enable execution logging in the API Gateway console for additional debugging.

## License

MIT
