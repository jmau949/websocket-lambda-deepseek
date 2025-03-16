import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  GetUserCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";

// Initialize Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || "us-east-1",
});

/**
 * User data interface with common Cognito attributes
 */
export interface UserData {
  sub: string;
  email?: string;
  "cognito:username"?: string;
  "cognito:groups"?: string[];
  [key: string]: any;
}

/**
 * Verify an access token using Cognito's GetUser API and extract user data
 *
 * @param accessToken - The Cognito access token to verify
 * @returns User data if token is valid, null otherwise
 */
export const verifyAccessToken = async (
  accessToken: string
): Promise<UserData | null> => {
  try {
    // Call Cognito GetUser API which validates the token and returns user attributes
    const command = new GetUserCommand({ AccessToken: accessToken });
    const response: GetUserCommandOutput = await cognitoClient.send(command);

    // Process user attributes into a simple object
    const userData: UserData = {
      sub: "", // Will be populated from attributes
    };

    // Extract user attributes
    response.UserAttributes?.forEach((attr) => {
      if (attr.Name && attr.Value) {
        userData[attr.Name] = attr.Value;
      }
    });

    // Ensure we have a subject identifier
    if (!userData.sub) {
      console.log("User ID (sub) not found in token attributes");
      return null;
    }

    return userData;
  } catch (error) {
    // Token is invalid, expired, or revoked
    console.error("Token verification error:", error);
    return null;
  }
};
