import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import { config } from "../config/config";
import {
  ServiceDiscoveryClient,
  DiscoverInstancesCommand,
} from "@aws-sdk/client-servicediscovery";

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

interface DiscoveredInstance {
  Attributes?: Record<string, string>;
}

// Store the client instance
let llmClient: any = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Discover LLM service instance using AWS Service Discovery
 */
const discoverLlmService = async (): Promise<string> => {
  console.log("Attempting to discover LLM service via service discovery...");
  try {
    // Parse service discovery namespace and service names
    const endpointComponents = config.llm.endpoint.split(".");
    if (endpointComponents.length < 2) {
      throw new Error(
        `Invalid service discovery format: ${config.llm.endpoint}`
      );
    }

    const serviceName = endpointComponents[0];
    const namespaceName = endpointComponents.slice(1).join(".");

    console.log(
      `Looking for service: ${serviceName} in namespace: ${namespaceName}`
    );

    // Initialize ServiceDiscovery client
    const serviceDiscovery = new ServiceDiscoveryClient({
      region: config.region,
    });

    // Discover instances
    const discoverCommand = new DiscoverInstancesCommand({
      NamespaceName: namespaceName,
      ServiceName: serviceName,
      MaxResults: 1, // Just need one healthy instance
    });

    const response = await serviceDiscovery.send(discoverCommand);

    if (!response.Instances || response.Instances.length === 0) {
      throw new Error(`No instances found for ${serviceName}.${namespaceName}`);
    }

    const instance = response.Instances[0] as DiscoveredInstance;
    if (!instance.Attributes) {
      throw new Error("Instance attributes missing");
    }

    const ipv4 = instance.Attributes["AWS_INSTANCE_IPV4"];
    const port = instance.Attributes["AWS_INSTANCE_PORT"] || "50051";

    const endpoint = `${ipv4}:${port}`;
    console.log(`LLM service discovered at: ${endpoint}`);

    return endpoint;
  } catch (error) {
    console.error("Failed to discover LLM service:", error);
    // Fallback to configured endpoint if unable to discover
    console.log(`Falling back to configured endpoint: ${config.llm.endpoint}`);
    return config.llm.endpoint;
  }
};

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
    // Discover service via AWS Service Discovery
    let endpoint = config.llm.endpoint;

    // Only attempt service discovery if endpoint looks like a service discovery name
    if (endpoint.includes(".") && !endpoint.includes(":")) {
      try {
        endpoint = await discoverLlmService();
      } catch (discoveryError) {
        console.warn(
          `Service discovery failed, using configured endpoint: ${endpoint}`
        );
      }
    }

    console.log(`Using endpoint: ${endpoint}`);

    const PROTO_PATH = path.resolve(__dirname, "../proto/llm.proto");

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
      endpoint,
      grpc.credentials.createInsecure(),
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
