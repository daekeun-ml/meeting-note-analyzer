# Security

## Reporting

Use GitHub's private vulnerability reporting for this repository when available. Do not attach credentials, recordings, transcripts, signed download URLs, or deployment output files to a public issue.

## Known dependency advisories

The 2026-10-25 security update upgrades Zod, Vitest, Vite, CDK and affected transitive JavaScript dependencies. `npm audit` reports no known vulnerabilities for the updated lockfile. Node 22.12+, 24.x or 26+ is required by the test toolchain.

The Python lockfiles upgrade certifi, Pillow, PyJWT, urllib3, Lightning, Accelerate and other affected dependencies. Security minimum versions are constrained in each `pyproject.toml`; the pip-based STT image and model publisher also apply `security-constraints.txt`. Rebuild images to incorporate these updates. GPU dependency resolution was checked, but local CPU tests do not validate GPU inference.

One dependency advisory remains in the agents environment: [GHSA-xcq7-p3pf-p88h](https://github.com/advisories/GHSA-xcq7-p3pf-p88h), unbounded `tracestate` parsing in `opentelemetry-api` 1.44.0. Even `aws-opentelemetry-distro` 0.21.0 pins this version and prevents an ordinary upgrade to the patched API 1.45.1. `meeting_agents.telemetry_security` wraps the configured propagator before either runtime accepts traffic and drops combined incoming `tracestate` values over 512 characters or 32 header entries before the vulnerable parser. Valid trace context and the configured X-Ray/baggage propagation remain delegated. This is a runtime mitigation, not removal of the dependency advisory. Upgrade to a compatible AWS distro and remove the guard once available.

OSV queries of the three updated lockfiles found only that advisory on 2026-10-25. This is a source/lockfile assessment, not a scan of an already deployed container or its operating-system packages. Model checkpoint loading still requires trusted, reviewed artifacts.

## Request and push limits

JSON API requests are limited to 256 KiB before decoding/parsing. Validation errors include at most five entries, and multipart completion lists are limited to the application's actual upload sizes (32 audio parts or 256 video parts).

Push subscriptions accept only HTTPS destinations at supported Google, Mozilla, Apple and Windows push hosts, without credentials, fragments or nonstandard ports. Keys have bounded base64url encodings. Stored subscriptions are revalidated before sending, so unsafe legacy destinations are removed without outbound requests. New registrations reserve one of 20 per-user slots transactionally; re-registration of an existing device does not consume another slot. Delivery reads at most 20 subscriptions, sends at most four concurrently and applies a five-second request timeout. Legacy users with more than 20 entries should remove unused subscriptions; only the first bounded page is used during migration and delivery.

## Authentication and access

The web app uses Cognito managed login with an authorization code flow and PKCE. It is a public application client with no client secret. Accounts are created by an AWS administrator, and public self-sign-up is disabled.

Application API requests require a Cognito token. Meeting, lecture, and chat handlers check ownership. The browser uses time-limited signed URLs for files. Treat those URLs as temporary credentials while they are valid.

Shared lectures use a separate Cognito Essentials pool with email OTP. `/api/guest/lectures/*` routes bypass the API Gateway authorizer and are verified by the guest Lambda. `POST /api/guest/logout` requires a Lambda authorizer at API Gateway that verifies the guest cookie's JWT signature, issuer, client audience, ID-token use, and expiry without caching authorization decisions. The logout handler also verifies the session before clearing the cookie.

The default CloudFront hostname provides HTTPS. The site and data buckets block public access. API, upload, and chat routes use separate CloudFront behaviors so API errors are not rewritten as web pages.

## Deployment information

Do not commit:

- AWS credentials, access tokens, passwords, private keys, or webhooks
- `deploy.local.json`, `.deployment/`, CDK output/context files, or local web configuration
- User recordings, slides, transcripts, generated notes, or exports
- Logs or screenshots containing real user data

Run `npm run check:public` and Gitleaks before publishing changes. The built-in source check reports file names and line numbers, not the matched values. It is a guard against common mistakes, not a complete security audit.

Secret setup uses Secrets Manager. Temporary CLI request files have mode 0600 and are removed after the request. The AWS CLI still uses the credentials and profile configured on the operator's machine.

## Data handling

Recordings, model files, transcripts, and results are stored in S3. Metadata and chat history are stored in DynamoDB. Retrieval uses a Bedrock knowledge base, and AgentCore Memory stores selected conversation and analysis information.

Model calls use Amazon Bedrock. The default global inference profiles can route requests across regions. Review the selected profiles and AWS service configuration before uploading data with residency requirements.

Application deletion, retrieval indexing, memory cleanup, backups, and logs are separate operations. Index updates are asynchronous. Deleting a Cognito account or a CloudFormation stack does not remove every copy of its application data.

## Runtime permissions

Runtime roles are scoped to the application buckets, tables, workflows, and gateways where the service supports resource-level permissions. Some discovery, logging, callback, model, and managed-service permissions use broader resources. Review the generated IAM policies with `npm run diff` before deploying, particularly when using an organization permission boundary or SCP.

Public CI runs on GitHub-hosted runners with read-only repository permissions. It does not have AWS credentials and cannot deploy the application.
