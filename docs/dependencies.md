# Dependencies and build notes

## External services

| Dependency | Used for | Setup requirement |
| --- | --- | --- |
| Amazon Cognito | Email/password accounts and OAuth code flow | Created by CDK; administrator creates accounts |
| Amazon CloudFront and S3 | Web hosting, uploads, files | Created by CDK; no custom domain |
| SageMaker asynchronous inference | Transcription and diarization | GPU quota, image build, prepared model files |
| Amazon Bedrock | Claude model calls | Access to the configured inference profiles |
| AgentCore Runtime and Memory | Analysis workers and conversation memory | Supported region and IAM permissions |
| AgentCore Gateway and Web Search | Lecture paper search | Built-in Web Search connector availability |
| Bedrock managed knowledge base | Retrieval over notes and transcripts | Managed knowledge-base availability in the chosen region |
| Hugging Face | Downloading STT model weights | Read token and access to gated model repositories |
| CodeBuild | Model download and conversion | Access to the HF secret and application model prefix |

The application also creates Lambda functions, Step Functions workflows, DynamoDB tables, SNS topics, Secrets Manager entries, and CloudWatch logs and alarms.

The supplied model IDs are documented in the [Opus 5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html) and [Sonnet 5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html). Model availability and access are separate checks. `doctor` discovers profile metadata; the first application request verifies actual invocation access.

Web Search uses the [AgentCore managed Web Search connector](https://aws.amazon.com/blogs/aws/announcing-web-search-on-amazon-bedrock-agentcore-ground-your-ai-agents-in-current-accurate-web-knowledge/). No external search API key is configured by this project.

## Local tools

- Node.js and npm install the TypeScript workspaces and build the web application.
- Python and uv install the worker and test dependencies.
- AWS CLI performs deployment preparation and account administration.
- Docker and Buildx build the ARM64 analysis runtimes and AMD64 GPU container.
- FFmpeg is used in the lecture container and in video tests. LibreOffice renders PPTX files in the lecture container.

The web app needs `web/public/config.json` for local development. `npm run dev:config` downloads it from your installation. It contains public application identifiers, but it is deployment-specific and stays out of Git.

## Reproducibility

`package-lock.json` and the Python project lockfiles are committed. Use `npm ci` and `uv sync --frozen` for development and CI. The meeting, chat, and lecture runtime images install from their Python lockfiles.

The SageMaker image has separate GPU dependencies and a pinned CrisperWhisper source revision. The source revision supplies word-decoding behavior required by the transcription output. Its build also downloads CUDA/PyTorch wheels. Base images, operating-system packages, model weights, and external service behavior still need review when updating an installation.

Model weights are downloaded from the provider repositories during setup, not redistributed in this repository. The model publisher stores them in your S3 bucket. Increment the model revision and redeploy when changing weights already loaded by SageMaker.

## Licenses and model access

Third-party libraries, container images, and model weights keep their own licenses and terms. In particular, a repository license does not grant access to gated models or commercial model variants. Review the linked model cards and the licenses included with installed dependencies before using the application for a new purpose.

## Validation scope

CI runs source checks, unit tests, type checks, a web build, and CDK synthesis with an example account number. It has no AWS credentials and performs no deployment or real model invocation.

The CDK template check verifies the default CloudFront certificate, the absence of Route 53/ACM resources, and native Cognito authentication. A fresh AWS deployment, GPU inference, model access, search, and browser authentication must still be tested in the target account using the deployment guide.
