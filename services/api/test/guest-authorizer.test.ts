import { sign, type KeyObject } from "node:crypto";
import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  process.env["GUEST_USER_POOL_ID"] = "us-east-1_GuestTest";
  process.env["GUEST_USER_POOL_CLIENT_ID"] = "guest-test-client";
  return { privateKey: undefined as KeyObject | undefined };
});
// Keep real JWT signature/claim verification; supply a local public key instead of fetching Cognito JWKS.
vi.mock("aws-jwt-verify", async (original) => {
  const actual = await original<typeof import("aws-jwt-verify")>();
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  fixture.privateKey = privateKey;
  return { CognitoJwtVerifier: {
    create: (options: { userPoolId: string; clientId: string; tokenUse: "id" }) => {
      const verifier = actual.CognitoJwtVerifier.create(options);
      verifier.cacheJwks({ keys: [{ ...publicKey.export({ format: "jwk" }), kty: "RSA", kid: "test-key", alg: "RS256", use: "sig" }] });
      return verifier;
    },
  } };
});
import { handler } from "../src/handlers/guest-authorizer.js";

function token(overrides: Record<string, unknown> = {}) {
  const payload = { sub: "guest-subject", iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_GuestTest",
    aud: "guest-test-client", token_use: "id", exp: Math.floor(Date.now() / 1000) + 3600, ...overrides };
  const encoded = [ { alg: "RS256", kid: "test-key" }, payload ]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
  return `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), fixture.privateKey!).toString("base64url")}`;
}
function event(headers: Record<string, string> = {}, cookies?: string[]) {
  return { version: "2.0", type: "REQUEST", headers, cookies } as APIGatewayRequestAuthorizerEventV2;
}

it("accepts a signed guest ID token from HTTP API cookies or the Cookie header", async () => {
  const cookie = `mna_guest=${token()}`;
  expect(await handler(event({}, ["unrelated=value", cookie]))).toEqual({ isAuthorized: true });
  expect(await handler(event({ Cookie: `unrelated=value; ${cookie}` }))).toEqual({ isAuthorized: true });
});

it.each([
  { exp: 1 },
  { iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OwnerPool" },
  { aud: "another-client" },
  { token_use: "access" },
])("rejects signed tokens with invalid guest claims: %j", async (claims) => {
  expect(await handler(event({}, [`mna_guest=${token(claims)}`]))).toEqual({ isAuthorized: false });
});

it("rejects missing, empty, malformed, forged and ambiguous guest cookies", async () => {
  const jwt = token();
  const [header, payload] = jwt.split(".");
  const forged = `${header}.${payload}.${Buffer.alloc(256).toString("base64url")}`;
  for (const request of [
    event(), event({ authorization: `Bearer ${jwt}` }), event({}, ["other=value"]),
    event({}, ["mna_guest="]), event({}, ["mna_guest=invalid"]), event({}, [`mna_guest=${forged}`]),
    event({}, [`mna_guest=${jwt}`, `mna_guest=${jwt}`]),
  ]) expect(await handler(request)).toEqual({ isAuthorized: false });
});
