import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { HttpError } from "./http.js";

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env["GUEST_USER_POOL_ID"] ?? "",
  clientId: process.env["GUEST_USER_POOL_CLIENT_ID"] ?? "",
  tokenUse: "id",
});

export const verifyGuestToken = (token: string) => verifier.verify(token);

export async function guestSession(event: Partial<Pick<APIGatewayProxyEventV2, "headers" | "cookies">>) {
  const header = Object.entries(event.headers ?? {}).find(([name]) => name.toLowerCase() === "cookie")?.[1];
  const cookies = (event.cookies ?? [header ?? ""]).flatMap((value) => value.split(";"))
    .map((value) => value.trim()).filter((value) => value.startsWith("mna_guest="));
  if (cookies.length !== 1 || !cookies[0]!.slice("mna_guest=".length)) {
    throw new HttpError(401, "초대된 이메일로 인증해 주세요", "guest_auth_required");
  }
  try { return await verifyGuestToken(cookies[0]!.slice("mna_guest=".length)); }
  catch { throw new HttpError(401, "이메일 인증이 만료되었습니다. 다시 인증해 주세요", "guest_auth_required"); }
}
