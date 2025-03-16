Here's the complete flow of how AWS API Gateway WebSockets work with Lambda integration and authorization:
API Gateway WebSocket Flow
Copy┌─────────────────┐   1. Connection Request    ┌────────────────────┐
│                 │ ─────────────────────────> │                    │
│  Client (Web    │                            │   API Gateway      │
│  Browser/App)   │                            │   WebSocket API    │
│                 │                            │                    │
└─────────────────┘                            └──────────┬─────────┘
        ▲                                                 │
        │                                                 │ 2. Authorize Connection
        │                                                 ▼
        │                                      ┌────────────────────┐
        │                                      │                    │
        │                                      │  Cognito/Lambda    │
        │                                      │  Authorizer        │
        │                                      │                    │
        │                                      └──────────┬─────────┘
        │                                                 │
        │                                                 │ 3. Auth Result
        │                                                 ▼
        │                                      ┌────────────────────┐
        │                                      │                    │
        │                  4a. 401 Response    │   API Gateway      │
        │ <────────────────(if auth fails)──── │   WebSocket API    │
        │                                      │                    │
        │                                      └──────────┬─────────┘
        │                                                 │
        │                                                 │ 4b. If auth succeeds
        │                                                 ▼
        │                                      ┌────────────────────┐
        │                                      │                    │
        │                                      │   $connect Lambda  │
        │                                      │   Function         │
        │                                      │                    │
        │                                      └──────────┬─────────┘
        │                                                 │
        │                                                 │ 5. Connection Result
        │                                                 ▼
        │                                      ┌────────────────────┐
        │                                      │                    │
        │                  6a. Connection      │   API Gateway      │
        │ <────────────────Established──────── │   WebSocket API    │
        │                                      │                    │
        │                                      └──────────┬─────────┘
        │                                                 │
        │ 7. WebSocket Messages                           │
        │ ─────────────────────────────────────────────> │
        │                                                 │
        │                                                 │ 8. Route Messages
        │                                                 ▼
        │                                      ┌────────────────────┐
        │                                      │                    │
        │                                      │  Message Lambda    │
        │                                      │  Functions         │
        │                                      │                    │
        │                                      └──────────┬─────────┘
        │                                                 │
        │                                                 │ 9. Message Response
        │                                                 ▼
        │                                      ┌────────────────────┐
        │                  10. Response        │                    │
        │ <────────────────Message────────────┤   API Gateway      │
        │                                      │   WebSocket API    │
        │                                      │                    │
        └─────────────────────────────────────┴────────────────────┘
Detailed Flow Explanation

Initial Connection Request:

Client sends a WebSocket connection request (WS or WSS protocol)
Request includes HTTP headers, cookies, and query parameters
The connection request is received by API Gateway


Authorization Check:

If a Cognito or Lambda authorizer is configured for the $connect route:

API Gateway forwards the request details to the authorizer
For Cognito: Validates JWT token
For Lambda: Calls a Lambda function that returns Allow/Deny policy




Authorization Result:

Authorizer returns the result to API Gateway:

Success: Includes identity information, IAM policy
Failure: Returns unauthorized status




Connection Handling:

If authorization fails:

API Gateway returns 401/403 error
Connection is immediately closed
No Lambda functions are invoked


If authorization succeeds:

API Gateway proceeds to the $connect route




$connect Lambda Function:

Receives the connection event with authorization context
Can perform additional validation/business logic
Stores connection information (typically in DynamoDB)
Returns success (2xx) or failure (4xx/5xx)


Connection Establishment:

If $connect Lambda returns success:

API Gateway completes WebSocket handshake
Connection is established with a unique connectionId
Client receives confirmation


If $connect Lambda returns failure:

Connection is rejected
Client receives error status




Message Exchange:

Once connected, client can send WebSocket messages
Messages include a "route" (action) field indicating the operation


Message Routing:

API Gateway routes messages based on the route field to different Lambda functions
Routes are defined in API Gateway configuration (e.g., "message", "getHistory", etc.)
For unknown routes, the $default route is used


Message Processing:

The appropriate Lambda function processes the message
Can perform business logic, database operations, etc.
Has access to the connectionId and (optionally) user identity from $connect
Can return responses directly or trigger asynchronous processes


Response Handling:

Lambda can send responses back to the client using:

Return value (for simple responses)
Management API calls (for targeted responses to specific connections)


API Gateway forwards responses to the client


Disconnection (not shown in diagram):

When client disconnects or connection times out
API Gateway invokes the $disconnect route Lambda
Lambda typically cleans up connection information in the database



Important Security Points

Authorization Chain:

Authorizer → $connect Lambda → Message Lambdas
Authorization cannot be bypassed - if the authorizer or $connect fails, no messages can be sent


Security Inheritance:

Message Lambdas inherit the security context from the connection
They can optionally re-check authentication but typically don't need to


Connection ID as Security Token:

The connectionId is a secure, temporary identifier
Only authenticated clients can obtain a valid connectionId
All subsequent messages must include this connectionId (handled automatically by WebSocket protocol)