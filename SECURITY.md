# Security

## Reporting

Use GitHub's private vulnerability reporting for this repository when available. Do not attach credentials, recordings, transcripts, signed download URLs, or deployment output files to a public issue.

## Known dependency advisories

As of 2026-09-09, the repository has four open Dependabot alerts. This application synchronization does not change the dependency lockfiles or resolve those alerts.

| Dependency | Manifest | Severity | Upstream reference |
| --- | --- | --- | --- |
| `lightning` | `stt/uv.lock` | High | [Checkpoint loading advisory](https://github.com/advisories/GHSA-qqmf-gpg7-g8gw) |
| `accelerate` | `stt/uv.lock` | Moderate | [Sharded checkpoint issue](https://github.com/huggingface/accelerate/issues/4067) |
| `vitest` | `package-lock.json` | Moderate | [Mock redirect advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) |
| `@vitest/mocker` | `package-lock.json` | Moderate | [Mock redirect advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) |

The Vitest advisory concerns development-server file access. Its listed fix is 4.1.11, which requires an upgrade from this project's 3.x test toolchain. The Accelerate alert currently lists no patched release. Track these dependency upgrades separately from application validation.

Dependabot flags `lightning` 2.6.5 in `stt/uv.lock`, a transitive dependency of `pyannote.audio`, for [GHSA-qqmf-gpg7-g8gw / CVE-2026-58659](https://github.com/advisories/GHSA-qqmf-gpg7-g8gw). The advisory describes arbitrary code execution when loading a malicious model checkpoint.

This alert remains open. Review the upstream fix and a compatible package release before deployment, and use only trusted model checkpoints. The advisory's patched-version metadata differs from its description, so an automated version substitution needs verification. Unit tests, image builds, and secret scans do not establish that the affected dependency is fixed.

## Authentication and access

The web app uses Cognito managed login with an authorization code flow and PKCE. It is a public application client with no client secret. Accounts are created by an AWS administrator, and public self-sign-up is disabled.

Application API requests require a Cognito token. Meeting, lecture, and chat handlers check ownership. The browser uses time-limited signed URLs for files. Treat those URLs as temporary credentials while they are valid.

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
