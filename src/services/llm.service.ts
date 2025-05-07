import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import * as fs from "fs";
import { config } from "../config/config";

// LLM Request and Response interfaces
export interface LLMRequest {
  prompt: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  };
}

export interface LLMResponse {
  text: string;
  isComplete: boolean;
}

// Store the client instance
let llmClient: any = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3; // Increased to allow more retries
const RETRY_DELAY_MS = 1000; // Increased delay between retries
const CONNECTION_TIMEOUT_SECONDS = 10; // Reduced connection timeout to 10 seconds
const RESPONSE_TIMEOUT_SECONDS = 600; // 10 minutes for complete response generation

/**
 * Get or create the LLM service client with retry logic
 */
export const getLLMClient = async (): Promise<any> => {
  if (llmClient) {
    return llmClient;
  }

  connectionAttempts++;
  console.log(
    `Attempting to connect to LLM service (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})...`
  );

  try {
    // Use the endpoint configured in environment or config
    const endpoint = config.llm.endpoint;
    console.log(`Using LLM endpoint: ${endpoint}`);

    // Determine the correct path for the proto file based on the environment
    // For Lambda, the proto files should be in /var/task/proto
    // For local development, they should be in the src/proto directory
    let PROTO_PATH;

    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      // We're running in Lambda - use absolute path
      PROTO_PATH = "/var/task/proto/llm.proto";
    } else {
      // We're running locally
      PROTO_PATH = path.resolve(__dirname, "../proto/llm.proto");
    }

    console.log(`Using proto file at: ${PROTO_PATH}`);

    // Check if the file exists
    if (!fs.existsSync(PROTO_PATH)) {
      // Try alternative paths for troubleshooting
      console.error(`Proto file not found at ${PROTO_PATH}`);

      // Log a list of files in /var/task to help debug
      if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
        try {
          console.log("Checking /var/task directory:");
          if (fs.existsSync("/var/task")) {
            const files = fs.readdirSync("/var/task");
            console.log("Files in /var/task:", files);

            // Check if proto directory exists
            if (fs.existsSync("/var/task/proto")) {
              const protoFiles = fs.readdirSync("/var/task/proto");
              console.log("Files in /var/task/proto:", protoFiles);
            } else {
              console.log("/var/task/proto directory not found");
            }
          } else {
            console.log("/var/task directory not found");
          }
        } catch (err) {
          console.error("Error listing directory:", err);
        }
      }

      throw new Error(`Proto file not found at ${PROTO_PATH}`);
    }

    // Load the proto definition
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

    console.log(`Creating gRPC client for ${endpoint}...`);

    // Create the client with improved timeout and retry settings
    llmClient = new (protoDescriptor.llm as any).LLMService(
      process.env.AWS_LAMBDA_FUNCTION_NAME ? endpoint : `${endpoint}:50051`,
      process.env.AWS_LAMBDA_FUNCTION_NAME
        ? grpc.credentials.createSsl()
        : grpc.credentials.createInsecure(),
      {
        "grpc.service_config": JSON.stringify({
          methodConfig: [
            {
              name: [{ service: "llm.LLMService" }],
              retryPolicy: {
                maxAttempts: 5,
                initialBackoff: "1s",
                maxBackoff: "10s",
                backoffMultiplier: 2,
                retryableStatusCodes: ["UNAVAILABLE", "DEADLINE_EXCEEDED"],
              },
              timeout: "600s", // Use same 10-minute timeout for ALL method calls
            },
          ],
        }),
        "grpc.keepalive_time_ms": 60000, // 60 seconds
        "grpc.keepalive_timeout_ms": 10000, // 10 seconds
        "grpc.http2.min_time_between_pings_ms": 15000, // 15 seconds
        "grpc.keepalive_permit_without_calls": 1, // Allow keepalives without active calls
        "grpc.max_connection_idle_ms": 120000, // 120 seconds
        "grpc.client_idle_timeout_ms": 120000, // 120 seconds
        "grpc.max_reconnect_backoff_ms": 10000, // 10 seconds
        "grpc.initial_reconnect_backoff_ms": 1000, // 1 second
      }
    );

    // Check if service is available with increased timeout
    await new Promise<void>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + CONNECTION_TIMEOUT_SECONDS);

      console.log(`Setting connection deadline to ${deadline.toISOString()}`);

      // This is only for the initial connection check, still using 10 seconds
      llmClient.waitForReady(deadline, (error: Error | undefined) => {
        if (error) {
          console.error(`LLM client connection failed: ${error.message}`);
          // Extra debug info
          if (error.message.includes("Failed to connect")) {
            console.log(
              `DNS lookup for ${endpoint}: Verify VPC DNS configuration and network route`
            );
            console.log(
              `Security groups: Verify inbound/outbound rules allow 443 to ALB`
            );
            console.log(
              `VPC endpoints: Verify Lambda can reach the endpoint through the VPC`
            );
            console.log(
              `NAT Gateway: Verify if Lambda needs internet access via NAT`
            );
          }
          llmClient = null;
          reject(error);
        } else {
          console.log(`LLM client successfully connected to ${endpoint}`);
          connectionAttempts = 0;
          resolve();
        }
      });
    });

    return llmClient;
  } catch (error) {
    console.error(`Failed to initialize LLM client: ${error}`);
    llmClient = null;

    // Retry connection if max attempts not reached
    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      console.log(`Retrying connection in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return getLLMClient();
    }

    throw new Error(
      `Failed to connect to LLM service after ${MAX_CONNECTION_ATTEMPTS} attempts`
    );
  }
};

/**
 * Generate a full response from the LLM
 */
export const generateResponse = async (
  request: LLMRequest
): Promise<string> => {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await getLLMClient();

      const grpcRequest = {
        prompt: request.prompt,
        parameters: {
          temperature:
            request.parameters?.temperature || config.llm.defaultTemperature,
          max_tokens:
            request.parameters?.maxTokens || config.llm.defaultMaxTokens,
          top_p: request.parameters?.topP || config.llm.defaultTopP,
          presence_penalty:
            request.parameters?.presencePenalty ||
            config.llm.defaultPresencePenalty,
          frequency_penalty:
            request.parameters?.frequencyPenalty ||
            config.llm.defaultFrequencyPenalty,
        },
      };

      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + RESPONSE_TIMEOUT_SECONDS);

      client.Generate(
        grpcRequest,
        { deadline },
        (error: any, response: any) => {
          if (error) {
            console.error("Error generating response:", error);
            reject(error);
            return;
          }

          resolve(response.text);
        }
      );
    } catch (error) {
      console.error("Error in generateResponse:", error);
      reject(error);
    }
  });
};

/**
 * Stream a response from the LLM
 */
export const streamResponse = async (
  request: LLMRequest,
  onChunk: (chunk: LLMResponse) => Promise<void>
): Promise<void> => {
  try {
    console.log("Initializing LLM stream...");
    const client = await getLLMClient();

    const grpcRequest = {
      prompt: request.prompt,
      parameters: {
        temperature:
          request.parameters?.temperature || config.llm.defaultTemperature,
        max_tokens:
          request.parameters?.maxTokens || config.llm.defaultMaxTokens,
        top_p: request.parameters?.topP || config.llm.defaultTopP,
        presence_penalty:
          request.parameters?.presencePenalty ||
          config.llm.defaultPresencePenalty,
        frequency_penalty:
          request.parameters?.frequencyPenalty ||
          config.llm.defaultFrequencyPenalty,
      },
    };

    console.log("Starting gRPC streaming request...");
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + RESPONSE_TIMEOUT_SECONDS);
    console.log(
      `Setting response deadline to ${deadline.toISOString()} (${RESPONSE_TIMEOUT_SECONDS} seconds)`
    );

    const stream = client.GenerateStream(grpcRequest, { deadline });

    // Set up event handlers
    stream.on("data", async (response: any) => {
      await onChunk({
        text: response.text,
        isComplete: response.is_complete,
      });
    });

    return new Promise((resolve, reject) => {
      stream.on("end", () => {
        console.log("Stream ended.");
        resolve();
      });

      stream.on("error", (error: Error) => {
        console.error("Stream error:", error);
        reject(error);
      });

      stream.on("status", (status: any) => {
        console.log(`Stream status: ${status.code} - ${status.details}`);
      });
    });
  } catch (error) {
    console.error("Error in streamResponse:", error);
    throw error;
  }
};
