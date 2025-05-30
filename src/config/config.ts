export const config = {
  // DynamoDB
  connectionsTable: process.env.CONNECTIONS_TABLE || "ConnectionsTable",
  chatSessionsTable: process.env.CHAT_SESSIONS_TABLE || "ChatSessionsTable",
  frontendUrl: process.env.FRONTEND_URL || "ai.jonathanmau.com",
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
    defaultTemperature: parseFloat(
      process.env.LLM_DEFAULT_TEMPERATURE || "0.7"
    ),
    defaultMaxTokens: parseInt(
      process.env.LLM_DEFAULT_MAX_TOKENS || "2048",
      10
    ),
    defaultTopP: parseFloat(process.env.LLM_DEFAULT_TOP_P || "0.95"),
    defaultPresencePenalty: parseFloat(
      process.env.LLM_DEFAULT_PRESENCE_PENALTY || "0"
    ),
    defaultFrequencyPenalty: parseFloat(
      process.env.LLM_DEFAULT_FREQUENCY_PENALTY || "0"
    ),
  },
};