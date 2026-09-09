import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";
import type { ProjectConfig } from "./config.js";

export interface AuthStackProps extends StackProps { config: ProjectConfig }

/** Administrator-created Cognito accounts, email/password managed login and authorization code flow. */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly userPoolDomain: cognito.UserPoolDomain;
  readonly issuerUrl: string;
  readonly hostedUiBaseUrl: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${config.projectName}-users`, selfSignUpEnabled: false,
      signInAliases: { email: true }, signInCaseSensitive: false, autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY, featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: RemovalPolicy.RETAIN, deletionProtection: true,
    });
    const domainPrefix = config.cognitoDomainPrefix || `${config.projectName}-${this.account}-${this.region}`;
    this.userPoolDomain = this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix }, managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // The first deployment uses localhost. The deployment helper then supplies CloudFront's URL and reapplies Auth.
    const callbackUrls = [...(config.siteUrl ? [`${config.siteUrl}/callback`] : []), "http://localhost:5173/callback"];
    const logoutUrls = [...(config.siteUrl ? [`${config.siteUrl}/`] : []), "http://localhost:5173/"];
    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "web-pwa", generateSecret: false, authFlows: { userSrp: true },
      preventUserExistenceErrors: true, enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(4), idTokenValidity: Duration.hours(4), refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE], callbackUrls, logoutUrls },
    });
    new cognito.CfnManagedLoginBranding(this, "Branding", {
      userPoolId: this.userPool.userPoolId, clientId: this.userPoolClient.userPoolClientId, useCognitoProvidedValues: true,
    });
    this.issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;
    this.hostedUiBaseUrl = `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`;
    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, "HostedUiBaseUrl", { value: this.hostedUiBaseUrl });
    new CfnOutput(this, "IssuerUrl", { value: this.issuerUrl });
  }
}
