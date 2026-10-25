import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = "error") {
    super(message);
  }
}

export interface Caller {
  sub: string;
  email?: string;
  name?: string;
}

export function callerFrom(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = claims["sub"];
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "unauthorized", "unauthorized");
  return {
    sub,
    email: typeof claims["email"] === "string" ? claims["email"] : undefined,
    name: typeof claims["name"] === "string" ? claims["name"] : undefined,
  };
}

export function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export const MAX_API_BODY_BYTES = 256 * 1024;
const MAX_VALIDATION_ISSUES = 5;

export function parseBody<S extends z.ZodType>(event: Pick<APIGatewayProxyEventV2WithJWTAuthorizer, "body" | "isBase64Encoded">, schema: S): z.output<S> {
  const body = event.body ?? "";
  // Bound the encoded representation before allocating a decoded buffer or parsing JSON.
  const encodedLimit = event.isBase64Encoded ? 4 * Math.ceil(MAX_API_BODY_BYTES / 3) : MAX_API_BODY_BYTES;
  if (Buffer.byteLength(body, "utf8") > encodedLimit) throw new HttpError(413, "request body too large", "payload_too_large");
  const decoded = event.isBase64Encoded ? Buffer.from(body, "base64") : Buffer.from(body, "utf8");
  if (decoded.byteLength > MAX_API_BODY_BYTES) throw new HttpError(413, "request body too large", "payload_too_large");
  let raw: unknown;
  try {
    const text = decoded.toString("utf8");
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "invalid JSON body", "bad_request");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.slice(0, MAX_VALIDATION_ISSUES)
      .map((i) => `${i.path.join(".")}: ${i.message}`.slice(0, 200)).join("; "), "validation");
  }
  return parsed.data as z.output<S>;
}

export function pathParam(event: APIGatewayProxyEventV2WithJWTAuthorizer, name: string): string {
  const v = event.pathParameters?.[name];
  if (!v) throw new HttpError(400, `missing path parameter ${name}`, "bad_request");
  return decodeURIComponent(v);
}
