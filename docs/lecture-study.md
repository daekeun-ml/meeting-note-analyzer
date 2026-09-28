# Lecture study

Select **영상 MP4** or **음성 MP3** in the lecture upload form. A PPTX or PDF slide deck is optional for either format. Upload one recording per lecture.

**추가 요청 (선택)** accepts up to 2,000 characters for study preferences, such as “첨부 슬라이드의 38–48페이지 위주로 정리하고 수식은 쉬운 예시로 설명해 주세요.” Leaving it blank keeps the default analysis. Page numbers refer to the attached file's physical order, starting at 1. Requests guide explanation depth, emphasis, paper selection and review order; the original slide readings and speech alignment remain evidence based. Emphasis requests keep other sections available with briefer coverage.

The same request is available in the lecture detail view and exports. Customized study, paper and overview caches are separate from the default results. Retrying reuses the recording, transcript and source readings, while a different request cannot reuse an older request's study output. A page-specific request without the relevant attachment cannot supply missing source content.

For MP3 with slides, the pipeline matches recorded speech to the original pages by conceptual evidence. For MP3 alone, it organizes the transcript into chapters and topics, preserving timestamps for audio playback. Audio-only notes do not claim to have seen slides or diagrams. The prepare step probes the actual MP3 format and duration; a renamed non-MP3 file is rejected.

The pipeline extracts audio for transcription, samples video frames, and connects visible sections with spoken explanations. Sections confidently matched to an attached slide remain linked to that page. The remaining sections are grouped into chapters and topics using the timestamped speech and visual observations. Each topic becomes a study page with notes, concepts, questions, flashcards, and research references.

The outline aims for topics of two to six minutes instead of making a new study page at every screen change. Long transcripts are outlined in windows of about 45 minutes. Topic pages retain their source video ranges and use up to six representative scene frames as visual evidence. Page counts depend on the lecture and any attached deck.

## Inputs and limits

| Input | Limit |
| --- | --- |
| MP4 video | 4 GiB, 4 hours, up to 4K |
| MP3 audio | 500 MiB, 4 hours |
| Optional PPTX/PDF | 100 MiB, 120 pages |
| Sampled video sections | Up to 240 before topic grouping |
| Combined study entries | Up to 360 |

Use a browser-compatible MP4 encoding such as H.264/AAC for playback. The server may be able to decode a video that the browser cannot play. Silent videos can still produce visual notes, but no spoken explanation is available for those sections.

Screen and speech matching is approximate. Review sections marked uncertain or unmatched. Slides not shown in the video and material shown only in the video are kept separate.

## Study material

The lecture view provides:

- An overview, learning objectives, and a suggested review order
- Notes for each video topic or attached slide, with timestamps and source evidence
- Concept explanations, formulas, questions, and flashcards
- A Markdown export, flashcard CSV, and PDF through browser printing
- A transcript tab with TXT and Markdown downloads of the full original STT transcript
- Links back to the relevant video or audio times

The inferred audience and prerequisite knowledge come from the lecture content. Generated explanations and answers should be checked against the lecture and its references.

Theory explanations start with the idea in plain language, its purpose, and the prerequisites before introducing formal notation. Mathematical notes retain the original statement, explain symbols and assumptions, and provide a justified derivation and a concrete example. Bounded excerpts of the other deck pages supply context for earlier definitions. References may point only to supplied pages.

The model checks sign conventions, derivatives, dimensions, and assumptions against that context. A demonstrated inconsistency is shown as **원본 오류 수정**, with the original and corrected formulas kept separately; incomplete or ambiguous evidence is shown as **원본 확인 필요**. This is model-assisted review, not formal mathematical verification.

Existing documents stay readable. **학습 설명 업데이트** reruns a completed lecture with the current study prompt, reusing its transcription, slide readings, and successful research. Prompt version changes invalidate both attached-slide and video-topic study caches. Model calls during regeneration may incur costs.

## PDF and access

Choose **PDF로 저장** on the lecture page, then select **Save as PDF** in the browser print dialog. The print layout includes every study section, formulas rendered with KaTeX, source filenames and page references, explanations, review answers, flashcards, evidence, and paper links. It uses text and equations; download the original slide deck separately if you need its images.

PDF preparation happens in the browser. It does not upload a copy to another service or create a public share URL. Signed URLs for recordings, slide images, and private downloads are excluded from the print content. All lecture API routes retain login and owner checks. The saved PDF can be shared as a file.

The **전사** tab offers **TXT 다운로드** and **Markdown 다운로드**, including all segments, timestamps, and speaker IDs. Lectures currently produce an original transcript only. Meeting transcripts additionally offer the existing speaker-corrected version: select **보정 전사** or **원본 전사** before downloading. Review filters do not shorten the exported file, and pending speaker proposals remain marked as unapproved.

## Research references

Paper search uses Web Search through an IAM-authenticated AgentCore Gateway. Video topic pages in the same chapter share one set of recommendations, based on up to three search queries for that chapter. Attached slide pages retain their own searches, with up to two queries per page.

The final result contains up to three papers, with source titles and URLs copied from the search results. If the model proposes extra candidates or overly long guidance within the accepted response limits, the selector keeps the first three choices and limits each explanation to 800 characters. Each retained choice must reference an existing, distinct search result.

Search can fail independently of study generation. The interface distinguishes a failed search from a search with no matching papers. A retry can reuse completed processing.

After deployment, check the gateway with:

```bash
uv run --project lecture python scripts/dev/check-lecture-gateway.py \
  --stack MeetingAnalyzer-Lecture --region us-east-1
```

Add `--search` to perform one fixed test query. Use your own stack prefix and region. This runs in the lecture runtime role and checks the actual connector, rather than assuming a synthesized configuration proves service availability.

## Processing and costs

Lectures share the SageMaker transcription endpoint with meetings. An endpoint scaled to zero takes time to start. Temporary model-service failures are retried automatically, with cached scene and page analysis reused on the next attempt. Invalid inputs and permission errors still require attention. See [lecture retries](operations.md#lecture-retries) for the waiting intervals and failure handling.

Model and search limits apply to one runtime attempt. Automatic phase retries and manual retries start new bounded attempts, so a lecture's total calls can exceed a single attempt's limit. Long videos, many visible sections, and repeated retries increase cost.

Page work uses four worker threads by default. Reading slides, observing and matching scenes, generating notes, and researching page groups can run concurrently, while results retain their original order. Model-call and token counters are protected across workers, and search calls share the configured request limit.

See [deployment](deployment.md) for setup and [operations](operations.md) for monitoring and resource management.
