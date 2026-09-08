# Public release review

Review date: 2026-09-07.

## Removed from the public copy

- Live deployment outputs, account identifiers, hosted-zone information, and application endpoint identifiers
- Personal email defaults, an email allowlist, and deployment-specific test-account scripts
- Private runner configuration, internal design notes, generated graph reports, and a prior application screenshot
- The original Git history and remote configuration

The public repository starts with a new history. Its commit identity uses the maintainer's GitHub no-reply address.

## Deployment changes

- CloudFront uses its generated hostname and default certificate. No Route 53 or ACM resources are required.
- Cognito uses administrator-created email/password accounts. Public sign-up and Google federation are disabled.
- The deployment helper discovers the CloudFront address and applies it to Cognito, CORS, uploads, and backend links.
- Account and region selection comes from the operator's AWS credentials and ignored local configuration.
- Hugging Face and VAPID secrets are created through a helper that keeps secret values out of command arguments.
- Model publishing precedes endpoint creation. A foundation-only command refuses to remove an existing endpoint.
- Runtime dependencies use lockfiles where supported. Public CI uses GitHub-hosted runners and has no AWS credentials.

## Checks performed

| Check | Result |
| --- | --- |
| Source scan for private deployment files, account numbers, credentials, emails, and local paths | Passed; example values and upstream lockfile contact metadata are treated separately |
| Gitleaks scan of an exported source tree | No findings |
| npm audit, including development dependencies | No known vulnerabilities reported at review time |
| TypeScript tests and type checks | Passed |
| Deployment helper and source-check tests | Passed |
| Python meeting-agent and STT tests | Passed; the local STT environment skips the PyTorch-dependent diarization test |
| Lecture tests inside the lecture container | 36 passed, including FFmpeg tests |
| Meeting, chat, lecture, and STT container image builds | Passed for their target architectures |
| Initial and active CDK configurations | Synthesized; template checks confirmed default CloudFront hosting and native Cognito authentication |
| Browser login entry | Email/password button and authorization code flow with an S256 PKCE challenge confirmed using a test identity-provider endpoint |

## Not verified by this review

No application was deployed to AWS during release preparation. Real Cognito authentication, target-account quotas and entitlements, weighted GPU transcription, model-generated output quality, and live Gateway search still require the post-deployment checks in the deployment guide.

These checks cover the release copy and its setup changes. They are not a penetration test or a guarantee that future dependency versions remain free of vulnerabilities.
