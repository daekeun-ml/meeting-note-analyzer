#!/usr/bin/env python3
"""Verify the public deployment shape after CDK synthesis, without contacting AWS."""
import json
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "infra/cdk.out")
templates = [json.loads(p.read_text()) for p in root.glob("*.template.json")]
assert templates, "Run npm run synth first"
resources = [r for template in templates for r in template.get("Resources", {}).values()]
data_resources = [resource for path in root.glob("*-Data.template.json") for resource in json.loads(path.read_text()).get("Resources", {}).values()]
data_buckets = [resource["Properties"] for resource in data_resources if resource["Type"] == "AWS::S3::Bucket"]
assert len(data_buckets) == 1, "Expected one application data bucket"
assert data_buckets[0]["VersioningConfiguration"]["Status"] == "Enabled"
tables = [r["Properties"] for r in resources if r["Type"] == "AWS::DynamoDB::Table"]
assert len(tables) == 3 and all(table.get("DeletionProtectionEnabled") for table in tables)
assert not any(r["Type"].startswith(("AWS::Route53::", "AWS::CertificateManager::")) for r in resources), "Unexpected custom domain dependency"
clients = [r["Properties"] for r in resources if r["Type"] == "AWS::Cognito::UserPoolClient"]
assert len(clients) == 2, "Expected the web login and server-only lecture guest clients"
web_client = next(client for client in clients if client.get("ClientName") == "web-pwa")
assert web_client["SupportedIdentityProviders"] == ["COGNITO"]
assert web_client["AllowedOAuthFlows"] == ["code"]
assert web_client["GenerateSecret"] is False
guest_client = next(client for client in clients if client.get("ClientName") == "lecture-share-email-verification")
assert guest_client["GenerateSecret"] is True
assert guest_client["ExplicitAuthFlows"] == ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
assert not guest_client.get("AllowedOAuthFlows"), "Guest verification must go through the server"
assert guest_client["ReadAttributes"] == ["email", "email_verified"]
api_template = next(json.loads(p.read_text()) for p in root.glob("*-Api.template.json"))
api_resources = api_template["Resources"]
logout = next(r["Properties"] for r in api_resources.values()
              if r["Type"] == "AWS::ApiGatewayV2::Route" and r["Properties"]["RouteKey"] == "POST /api/guest/logout")
assert logout["AuthorizationType"] == "CUSTOM", "Guest logout must require session authentication at API Gateway"
guest_authorizer = api_resources[logout["AuthorizerId"]["Ref"]]["Properties"]
assert guest_authorizer["AuthorizerType"] == "REQUEST"
assert guest_authorizer["IdentitySource"] == ["$request.header.Cookie"]
assert guest_authorizer["AuthorizerPayloadFormatVersion"] == "2.0"
assert guest_authorizer["EnableSimpleResponses"] is True
assert guest_authorizer["AuthorizerResultTtlInSeconds"] == 0, "Do not cache an expired guest session's authorization"
for resource in resources:
    if resource["Type"] == "AWS::CloudFront::Distribution":
        props = resource["Properties"]["DistributionConfig"]
        assert not props.get("Aliases"), "CloudFront must use its generated hostname"
        certificate = props.get("ViewerCertificate", {})
        assert not certificate or certificate.get("CloudFrontDefaultCertificate") is True
        assert "AcmCertificateArn" not in certificate and "IamCertificateId" not in certificate
print(f"Verified {len(templates)} stack templates: CloudFront default certificate, no DNS dependency, Cognito accounts and separate guest verification.")
