# Meeting briefs

A meeting brief is the short recap below the detailed meeting summary and notes. It contains the central outcome, selected decisions and their reasoning, action items, and open questions.

Use `핵심 요약 보기` to jump to the brief. `요약 복사` copies only the short recap. The complete Markdown export also includes the brief after the detailed material.

## Decision reasoning

Each selected decision can include two or three sentences describing the discussion: what prompted it, which alternatives were actually considered, and the stated reason for the choice. The brief does not turn proposals or AI suggestions into confirmed decisions.

The runtime checks referenced agenda items, decisions, follow-up IDs, questions, and transcript segment IDs. Decision and question text is taken from the detailed outputs; quoted evidence comes from the transcript. These checks validate references, while the model is responsible for interpreting the cited discussion.

When the reason is not recorded, the interface shows `결정 근거 미확인`. Unspecified task owners and deadlines are shown as `미정`. Open the evidence disclosure to inspect the source words and timestamp.

## Existing meetings

New analyses create the brief after the detailed stages finish. Meetings without one show `추가 요약 만들기`. This reads the existing transcript and published notes and runs only the new brief stage. It does not transcribe the recording again.

The published meeting remains readable while its brief is being created. Brief failures are tracked separately and can be retried. Existing speaker labels and detailed notes are kept, and follow-up owners remain linked to their original items.

Generating a brief uses the configured Sonnet model and incurs model charges. Opening the page or copying an existing brief does not generate it again.
