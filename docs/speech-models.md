# Speech model selection

New recordings default to **Qwen3-ASR-1.7B-hf** for transcription and **NVIDIA Nemotron 3 Diarization** for speaker diarization. Account defaults are saved under Settings. Meeting, lecture and interview uploads can override them before an upload plan is created.

| Component | Choice | Purpose |
| --- | --- | --- |
| STT | [Qwen3-ASR-1.7B-hf](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf) | Default multilingual ASR, including Korean |
| STT | [CrisperWhisper 2.0 large](https://huggingface.co/nyralabs/CrisperWhisper2.0_large) | Existing transcription engine, including verbatim mode |
| STT | [ARK-ASR-0.6B](https://huggingface.co/Edge0/ARK-ASR-0.6B) | Alternative ASR, currently enabled for English recordings |
| Diarization | [Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization) | Default, up to eight speakers |
| Diarization | [pyannote Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) | Existing whole-recording diarization pipeline |
| Diarization | Disabled | One speaker label for a single-speaker recording |

Cohere Transcribe is excluded from the selectable models. CrisperWhisper's weights use the Nyra Health non-commercial research license; commercial use requires a separate license. Qwen and ARK use Apache 2.0, Nemotron uses OpenMDW 1.1, and Community-1 uses CC BY 4.0. Refer to the linked model cards for their terms.

ARK's card advertises Korean support, but the pinned checkpoint repeatedly returned Japanese text for the Korean validation clip, including when Korean was explicitly requested. Its English validation passed. The application therefore labels ARK as English-only, selects the English language hint for it, and rejects unsupported ARK requests before starting inference. Qwen remains the Korean-capable default. This is an integration limitation based on the tested sample, not a claim that every Korean recording behaves identically.

Qwen and ARK run with the native or reviewed model-specific Transformers interfaces. The separate [Qwen3 forced aligner](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf) produces their word timestamps. ASR and alignment use overlapping windows no longer than 30 seconds, then restore original recording offsets and remove duplicate recognition at seams. Words with invalid alignment times fail validation rather than receiving invented uniform timestamps. The aligner supports Korean, English, Japanese and Chinese, as well as a subset of the ASR models' other languages.

Nemotron uses streaming chunks and a speaker cache across the recording, so long audio does not need to fit into a single model forward pass. Its state is reset between recordings. The endpoint holds one selected model combination at a time to bound GPU memory usage. Models are loaded from the private S3 bundle, with offline Hugging Face loading.

The selected engines are stored on each recording and in the transcript. Per-record selections remain unchanged when account defaults change. Existing transcripts can be reused only for the same selected engines; new model-aware analysis caches also include a hash of the transcript. Records and queued requests created before model selection keep their original CrisperWhisper/Community-1 behavior.

## Model artifacts and rollout

[`model_catalog.json`](../stt/src/stt/model_catalog.json) pins the modern model revisions. ARK requires repository-provided Python code; the selected revision was inspected and is loaded only from the pinned local snapshot, never from a repository named by a user request.

The publisher keeps existing CrisperWhisper and Community-1 artifacts where available, downloads the pinned modern snapshots, and writes a manifest plus a completion marker. Bundles use a separate S3 prefix containing the catalog hash. Publishing a new bundle does not overwrite the previous deployment's model files.

`npm run models` sends the current publisher source and catalog to CodeBuild, including when the deployed publisher project still references an older source archive. `npm run deploy` checks bundle readiness before updating the endpoint.

For a scoped rollout, publish model artifacts and deploy the STT endpoint first. It accepts legacy requests without model choices. After its new-model smoke checks pass, deploy the pipeline, APIs, lecture/interview runtime and web controls that send explicit selections. Keep the original media and existing completed results intact.
