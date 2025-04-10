/**
 * Sanitization utilities for user input and LLM parameters
 */

// Maximum allowed message length (characters)
// Set high enough to allow code samples
export const MAX_MESSAGE_LENGTH = 100000;

// Default and maximum parameter values for safety
export const DEFAULT_PARAMS = {
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 1.0,
  top_k: 40,
  repetition_penalty: 1.0,
  stop: [],
};

export const MAX_PARAMS = {
  max_tokens: 4096,
  temperature: 2.0,
  top_p: 1.0,
  top_k: 100,
  repetition_penalty: 2.0,
};

/**
 * Result of input sanitization
 */
export interface SanitizationResult {
  sanitized: string;
  valid: boolean;
  errorMessage?: string;
}

/**
 * Sanitize user input to prevent security issues while allowing legitimate code
 * @param input - The user input to sanitize
 * @returns The sanitized input and validation result
 */
export const sanitizeUserInput = (input: string): SanitizationResult => {
  // Check if input is defined and is a string
  if (input === undefined || input === null) {
    return {
      sanitized: "",
      valid: false,
      errorMessage: "Input cannot be empty",
    };
  }

  if (typeof input !== "string") {
    return {
      sanitized: "",
      valid: false,
      errorMessage: "Input must be a string",
    };
  }

  // Trim whitespace
  const trimmedInput = input.trim();

  // Check for empty input after trimming
  if (trimmedInput.length === 0) {
    return {
      sanitized: "",
      valid: false,
      errorMessage: "Input cannot be empty",
    };
  }

  // Check for excessive length
  if (trimmedInput.length > MAX_MESSAGE_LENGTH) {
    return {
      sanitized: trimmedInput.substring(0, MAX_MESSAGE_LENGTH),
      valid: false,
      errorMessage: `Input exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters`,
    };
  }

  // Only block the most dangerous patterns that could directly affect EC2 security
  // Allow normal code patterns, even if they include command syntax
  const directSystemExploitPatterns = [
    // Real system exploitation attempts with direct addressing
    /\/etc\/passwd/i, // System files access
    /\/var\/log/i, // System logs access
    /\/root\//i, // Root directory access
    /\/home\/[^\/]+\/\.ssh/i, // SSH keys access
    /\/proc\/self/i, // Process info access

    // Actual command execution in context outside of code blocks
    /^\s*(?:sudo|apt-get|yum|rm\s+-rf)\s+/i, // Commands at start of message
    /\n\s*(?:sudo|apt-get|yum|chmod\s+777|rm\s+-rf)\s+/i, // Commands at start of line

    // Actual process execution methods
    /process\.exec\s*\(/i, // Node.js process execution
    /child_process\.exec/i, // Node.js child process explicit
    /os\.system\s*\(/i, // Python system commands
    /subprocess\.call\s*\(/i, // Python subprocess
    /Runtime\.getRuntime\(\)\.exec\s*\(/i, // Java runtime exec

    // Specific attack payloads
    /\|\|\s*curl\s+http/i, // Curl piped in shell
    /&&\s*wget\s+http/i, // Wget piped in shell
    /\|\|\s*nc\s+-e\s+\/bin\/bash/i, // Netcat shell
    /\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i, // Shellcode pattern
  ];

  // Check for direct system exploitation patterns
  for (const pattern of directSystemExploitPatterns) {
    if (pattern.test(trimmedInput)) {
      console.warn(
        `Potential EC2 exploitation attempt detected: matched pattern ${pattern}`
      );
      return {
        sanitized: trimmedInput,
        valid: false,
        errorMessage:
          "Input contains potentially dangerous system access patterns",
      };
    }
  }

  // Detect and block potential prompt injection attacks while allowing normal code
  const promptInjectionPatterns = [
    /ignore previous instructions/i,
    /ignore all previous commands/i,
    /disregard prior instructions/i,
    /override system prompt/i,
    /system:\s*[^\n]*/i, // Attempts to mimic system messages
  ];

  // Check for prompt injection patterns
  for (const pattern of promptInjectionPatterns) {
    if (pattern.test(trimmedInput)) {
      console.warn(
        `Potential prompt injection detected: matched pattern ${pattern}`
      );
      return {
        sanitized: trimmedInput,
        valid: false,
        errorMessage:
          "Input contains patterns that attempt to override system instructions",
      };
    }
  }

  // Do minimal sanitization to preserve code functionality
  // Only sanitize the most dangerous characters that could lead to direct execution
  const sanitized = trimmedInput.replace(
    /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g,
    ""
  ); // Remove control chars but keep tabs and newlines for code

  return { sanitized, valid: true };
};

/**
 * Sanitize LLM parameters to ensure they're within acceptable bounds
 * @param params - The parameters to sanitize
 * @returns Sanitized parameters
 */
export const sanitizeLLMParameters = (params: any = {}): any => {
  // Start with default parameters
  const sanitizedParams = { ...DEFAULT_PARAMS };

  // Process and validate each parameter
  if (typeof params.max_tokens === "number" && params.max_tokens > 0) {
    sanitizedParams.max_tokens = Math.min(
      params.max_tokens,
      MAX_PARAMS.max_tokens
    );
  }

  if (typeof params.temperature === "number" && params.temperature >= 0) {
    sanitizedParams.temperature = Math.min(
      params.temperature,
      MAX_PARAMS.temperature
    );
  }

  if (
    typeof params.top_p === "number" &&
    params.top_p > 0 &&
    params.top_p <= MAX_PARAMS.top_p
  ) {
    sanitizedParams.top_p = params.top_p;
  }

  if (typeof params.top_k === "number" && params.top_k > 0) {
    sanitizedParams.top_k = Math.min(params.top_k, MAX_PARAMS.top_k);
  }

  if (
    typeof params.repetition_penalty === "number" &&
    params.repetition_penalty > 0
  ) {
    sanitizedParams.repetition_penalty = Math.min(
      params.repetition_penalty,
      MAX_PARAMS.repetition_penalty
    );
  }

  // Handle stop tokens (if provided)
  if (Array.isArray(params.stop)) {
    // Only accept string stop tokens and limit their number
    sanitizedParams.stop = params.stop
      .filter((token: any) => typeof token === "string")
      .slice(0, 5); // Limit to 5 stop tokens
  }

  return sanitizedParams;
};

/**
 * Safely sanitize user input with error handling
 * @param input - User input to sanitize
 */
export const safelySanitizeInput = (input: any): SanitizationResult => {
  try {
    return sanitizeUserInput(String(input || ""));
  } catch (error) {
    console.error("Error in sanitizeUserInput:", error);
    return {
      sanitized: "",
      valid: false,
      errorMessage: "Failed to process input due to an internal error",
    };
  }
};

/**
 * Safely sanitize LLM parameters with error handling
 * @param params - Parameters to sanitize
 */
export const safelySanitizeParameters = (params: any): any => {
  try {
    return sanitizeLLMParameters(params);
  } catch (error) {
    console.error("Error in sanitizeLLMParameters:", error);
    // Return default parameters if there's an error
    return { ...DEFAULT_PARAMS };
  }
};

/**
 * Safely sanitize user input with minimal modifications
 * More permissive than the main sanitization to preserve code
 * @param input User input to sanitize with minimal changes
 */
export const lightlySanitizeInput = (input: string): string => {
  try {
    if (!input || typeof input !== "string") {
      return "";
    }

    // Only remove control characters that could break processing
    return input.replace(
      /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g,
      ""
    ); // Keep tabs and newlines for code
  } catch (error) {
    console.error("Error in lightlySanitizeInput:", error);
    return input; // Return original on error
  }
};

/**
 * Validate the overall message structure
 * @param message - The WebSocket message to validate
 * @returns Whether the message is valid
 */
export const validateMessageStructure = (
  message: any
): { valid: boolean; errorMessage?: string } => {
  // Validate action
  if (!message || typeof message.action !== "string") {
    return {
      valid: false,
      errorMessage: "Invalid message format: missing or invalid action",
    };
  }

  // For message actions, validate data structure
  if (message.action === "message") {
    // Check if data exists
    if (!message.data) {
      return {
        valid: false,
        errorMessage: "Invalid message format: missing data",
      };
    }

    // Validate message content
    if (message.data.message === undefined) {
      return {
        valid: false,
        errorMessage: "Invalid message format: missing message content",
      };
    }

    // Validate parameters if present
    if (
      message.data.parameters !== undefined &&
      (typeof message.data.parameters !== "object" ||
        Array.isArray(message.data.parameters))
    ) {
      return {
        valid: false,
        errorMessage: "Invalid message format: parameters must be an object",
      };
    }
  }

  return { valid: true };
};
