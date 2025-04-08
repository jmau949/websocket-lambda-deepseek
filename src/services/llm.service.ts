import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
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

/**
 * Get or create the LLM service client
 */
export const getLLMClient = (): any => {
  if (!llmClient) {
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

    // Create the client
    llmClient = new (protoDescriptor.llm as any).LLMService(
      config.llm.endpoint,
      grpc.credentials.createInsecure()
    );

    console.log(`LLM client initialized with endpoint: ${config.llm.endpoint}`);
  }

  return llmClient;
};

/**
 * Generate a full response from the LLM
 */
export const generateResponse = (request: LLMRequest): Promise<string> => {
  return new Promise((resolve, reject) => {
    const client = getLLMClient();

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
    deadline.setSeconds(deadline.getSeconds() + config.llm.timeoutMs / 1000);

    client.Generate(grpcRequest, { deadline }, (err: Error, response: any) => {
      if (err) {
        console.error("Error calling LLM service:", err);
        reject(err);
        return;
      }

      resolve(response?.text || "");
    });
  });
};

/**
 * Stream responses from the LLM
 */
export const streamResponse = (
  request: LLMRequest,
  onChunk: (chunk: LLMResponse) => Promise<void>
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const client = getLLMClient();

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
    console.log("request", request);
    try {
      console.log(
        `Streaming LLM request for prompt: ${request.prompt.substring(
          0,
          100
        )}...`
      );

      const stream = client.GenerateStream(grpcRequest);

      stream.on("data", async (response: any) => {
        const chunk: LLMResponse = {
          text: response.text,
          isComplete: response.is_complete,
        };

        await onChunk(chunk);
      });

      stream.on("end", () => {
        console.log("LLM stream completed");
        resolve();
      });

      stream.on("error", (error: Error) => {
        console.error("LLM stream error:", error);
        reject(error);
      });
    } catch (error) {
      console.error("Error creating LLM stream:", error);
      reject(error);
    }
  });
};
