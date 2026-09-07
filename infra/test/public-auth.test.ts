import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { AuthStack } from "../lib/auth-stack.js";
import { loadConfig } from "../lib/config.js";

it("uses native Cognito accounts with PKCE-compatible code flow and exact CloudFront callbacks", () => {
  const app = new App({ context: { siteUrl: "https://dexample.cloudfront.net" } });
  const stack = new AuthStack(app, "AuthTest", { config: loadConfig(app), env: { account: "000000000000", region: "us-east-1" } });
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::Cognito::UserPool", { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, UsernameAttributes: ["email"], DeletionProtection: "ACTIVE" });
  template.hasResourceProperties("AWS::Cognito::UserPoolClient", { GenerateSecret: false, SupportedIdentityProviders: ["COGNITO"], AllowedOAuthFlows: ["code"], CallbackURLs: ["https://dexample.cloudfront.net/callback", "http://localhost:5173/callback"], LogoutURLs: ["https://dexample.cloudfront.net/", "http://localhost:5173/"] });
  template.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 0);
  template.resourceCountIs("AWS::Lambda::Function", 0);
});
it("rejects non-CloudFront origins and invalid instance ranges", () => {
  expect(() => loadConfig(new App({ context: { siteUrl: "https://example.com" } }))).toThrow("CloudFront");
  expect(() => loadConfig(new App({ context: { sttMinInstances: 3, sttMaxInstances: 1 } }))).toThrow("sttMaxInstances");
});
