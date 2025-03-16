export const config = {
  // DynamoDB
  connectionsTable: process.env.CONNECTIONS_TABLE || "ConnectionsTable",

  // Connection TTL in seconds (default: 2 weeks)
  connectionTtl: 1209600,

  // AWS region
  region: process.env.AWS_REGION || "us-east-1",
  auth: {
    jwksCacheTTL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  },

  // Cognito configuration
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || "",
    clientId: process.env.COGNITO_CLIENT_ID || "",
  },
};
