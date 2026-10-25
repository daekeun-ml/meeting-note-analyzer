import type { APIGatewayRequestAuthorizerEventV2, APIGatewaySimpleAuthorizerResult } from "aws-lambda";
import { guestSession } from "../lib/guest-session.js";

export async function handler(event: APIGatewayRequestAuthorizerEventV2): Promise<APIGatewaySimpleAuthorizerResult> {
  try {
    await guestSession(event);
    return { isAuthorized: true };
  } catch {
    return { isAuthorized: false };
  }
}
