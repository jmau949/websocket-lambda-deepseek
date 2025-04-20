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
const RETRY_DELAY_MS = 500;

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
      // We're running in Lambda
      PROTO_PATH = path.resolve(__dirname, "../../proto/llm.proto");
    } else {
      // We're running locally
      PROTO_PATH = path.resolve(__dirname, "../proto/llm.proto");
    }

    console.log(`Using proto file at: ${PROTO_PATH}`);

    // Check if the file exists
    if (!fs.existsSync(PROTO_PATH)) {
      console.error(`Proto file not found at ${PROTO_PATH}`);
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

    // Create the client with timeout and retries
    llmClient = new (protoDescriptor.llm as any).LLMService(
      `${endpoint}:443`, // Always use HTTPS port
      grpc.credentials.createSsl(), // Use SSL for secure communication with ALB
      {
        "grpc.service_config": JSON.stringify({
          methodConfig: [
            {
              name: [{ service: "llm.LLMService" }],
              retryPolicy: {
                maxAttempts: 5,
                initialBackoff: "0.1s",
                maxBackoff: "1s",
                backoffMultiplier: 2,
                retryableStatusCodes: ["UNAVAILABLE"],
              },
            },
          ],
        }),
        "grpc.keepalive_time_ms": 10000, // 10 seconds
        "grpc.keepalive_timeout_ms": 5000, // 5 seconds
        "grpc.http2.min_time_between_pings_ms": 10000, // 10 seconds
        "grpc.keepalive_permit_without_calls": 1, // Allow keepalives without active calls
      }
    );

    // Check if service is available
    await new Promise<void>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 5);

      llmClient.waitForReady(deadline, (error: Error | undefined) => {
        if (error) {
          console.error(`LLM client connection failed: ${error.message}`);
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
      deadline.setMilliseconds(
        deadline.getMilliseconds() + config.llm.timeoutMs
      );

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
    deadline.setMilliseconds(deadline.getMilliseconds() + config.llm.timeoutMs);

    const stream = client.GenerateStream(grpcRequest, { deadline });

    // Set up event handlers
    stream.on("data", async (response: any) => {
      console.log(`Stream chunk received: ${response.text.length} chars`);
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
