# AWS WebSocket Lambda API with Cognito Auth and DeepSeek LLM

A WebSocket application using AWS API Gateway WebSockets with Lambda integration, Cognito authentication, and DeepSeek LLM for AI chat functionality.

## Architecture Overview

This implementation uses a secure WebSocket API with:

- **React Client Frontend**: Web interface for user interactions
- **API Gateway WebSocket API**: Handles WebSocket connections with `$connect`, `$disconnect`, and message routes
- **Cognito Authentication**: Validates JWT tokens via cookies
- **Lambda Functions**: Process WebSocket events
- **DynamoDB**: Stores active connections and chat sessions

### New VPC Architecture

The system uses an enhanced architecture with the following components:

#### Resources outside the VPC:
- React client frontend
- API Gateway WebSockets with lambda handlers for `$authorizer` and `$connect`
- DynamoDB for managing connections and sessions

#### Resources inside the VPC:
- `$message` handler Lambda function
- Private Application Load Balancer (ALB)
- GPU instances hosting the DeepSeek LLM
- NAT Gateway for outbound connectivity

#### Key Features:
- Traffic between message handlers and GPU instances uses gRPC with sticky sessions
- The message handler Lambda is inside the VPC and uses a NAT Gateway to connect to DynamoDB and API Gateway for WebSocket responses
- Private ALB uses verified custom domain name (deepseek.jonathanmau.com) with ACM certificate
- Message handler connects to DeepSeek LLM service via the private ALB

### API Gateway WebSocket Flow

The request flow follows these steps:

1. **Connection Request**: Client initiates WebSocket connection with cookies
2. **Authorization**: API Gateway validates JWT token via Cognito authorizer
3. **Connection Establishment**: If authorized, $connect Lambda stores connection in DynamoDB
4. **Message Processing**: Messages are routed to the $message Lambda inside the VPC
5. **LLM Processing**: The $message Lambda communicates with DeepSeek LLM via private ALB using gRPC
6. **Response**: Lambda functions send streaming responses via the API Gateway Management API
7. **Disconnection**: On disconnect, $disconnect Lambda cleans up connection data

## Project Structure

```
websocket-lambda-deepseek/
├── src/
│   ├── handlers/      # Lambda handlers for WebSocket events
│   │   ├── authorizer.ts  # Authorizes connections via Cognito
│   │   ├── connect.ts     # Handles new connections
│   │   ├── disconnect.ts  # Handles client disconnections
│   │   ├── message.ts     # Processes incoming messages
│   │   ├── default.ts     # Handles unrecognized message formats
│   │   └── index.ts       # Exports all handlers
│   ├── services/      # Business logic services
│   │   ├── auth.service.ts       # JWT validation with JWKS caching
│   │   ├── connection.service.ts # DynamoDB connection storage
│   │   ├── chat-session.service.ts # Chat session management
│   │   ├── llm.service.ts        # LLM service integration
│   │   └── message.service.ts    # Message processing logic
│   ├── utils/         # Utility functions
│   │   ├── lambda.ts        # Lambda event helpers
│   │   ├── websocket.ts     # WebSocket communication utilities
│   │   ├── sanitization.ts  # Input validation and sanitization
│   │   └── conversation.ts  # Conversation history formatting
│   ├── proto/         # gRPC protocol definitions
│   │   └── llm.proto        # LLM service proto definition
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
5. VPC infrastructure with private subnets, security groups, and ALB already set up

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/websocket-lambda-deepseek.git
cd websocket-lambda-deepseek

# Install dependencies
npm install
```

### Configuration

1. Update Cognito settings in `src/config/config.ts`:

```typescript
export const config = {
  // DynamoDB
  connectionsTable: process.env.CONNECTIONS_TABLE || "ConnectionsTable",
  chatSessionsTable: process.env.CHAT_SESSIONS_TABLE || "ChatSessionsTable",
  
  // Connection TTL in seconds (default: 2 weeks)
  connectionTtl: 1209600,
  chatSessionTtl: 1209600,
  
  // AWS region
  region: process.env.AWS_REGION || "us-east-1",

  webSocket: {
    // Whether to enable broadcasting messages to all connections
    enableBroadcast: process.env.ENABLE_BROADCAST === "true",

    // Default stage name for API Gateway
    defaultStage: "Prod",
  },

  // Cognito configuration
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || "",
    clientId: process.env.COGNITO_CLIENT_ID || "",
  },
  
  llm: {
    // Use private ALB custom domain for the DeepSeek LLM service in VPC
    // The MessageFunction Lambda is inside the VPC and connects directly to the ALB
    endpoint: process.env.LLM_ENDPOINT || "deepseek.jonathanmau.com",
    defaultTemperature: 0.7,
    defaultMaxTokens: 2048,
    defaultTopP: 0.95,
    defaultPresencePenalty: 0,
    defaultFrequencyPenalty: 0,
    timeoutMs: 30000,
  },
};
```

2. Update `template.yaml` parameters to match your environment:

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
    
  DeepseekCustomDomain:
    Type: String
    Default: "deepseek.jonathanmau.com"
    Description: Custom domain name for the private ALB
    
  DeepseekCertificateArn:
    Type: String
    Default: "arn:aws:acm:us-west-2:034362047054:certificate/436d84a6-1cc3-432c-b5ca-d9150749a5f6"
    Description: ACM Certificate ARN for the deepseek custom domain
```

## Local Development

For local development, the project includes a WebSocket server that simulates API Gateway with Cognito authentication.

### Starting the Local Server

```bash
# First, update Cognito settings in local-server.ts
# Then run:
npm run dev
```

The server will start at `ws://localhost:3000` and will:
- Extract JWT tokens from HTTP cookies (from the Cookie header)
- Validate tokens against your Cognito User Pool
- Process WebSocket events using your Lambda handlers
- Store connections in memory instead of DynamoDB

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
- Cognito Client ID
- Custom domain name and certificate ARN

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
    message: 'What is the capital of France?',
    parameters: {
      temperature: 0.7,
      maxTokens: 2048
    }
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

## Monitoring and Debugging

### CloudWatch Logs

Each Lambda function logs to CloudWatch with 30-day retention:

```
/aws/lambda/stack-name-AuthorizerFunction-XXXX
/aws/lambda/stack-name-ConnectFunction-XXXX
/aws/lambda/stack-name-DisconnectFunction-XXXX
/aws/lambda/stack-name-MessageFunction-XXXX
/aws/lambda/stack-name-DefaultFunction-XXXX
```

### API Gateway Logs

Enable execution logging in the API Gateway console for additional debugging.

## License

MIT
