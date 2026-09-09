# Speaker correction and review

Meeting recordings first receive acoustic speaker labels from pyannote. The speaker attribution stage then uses the transcript to propose names, combine duplicate labels, or correct the speaker of an individual utterance. This step does not change the transcription model or the recorded words.

## What gets applied

A correction must pass all of these checks:

- The model identifies direct identity evidence in this recording and marks the proposal as confirmed.
- Its reported confidence is at least 0.85. This threshold is a filter, not a measured accuracy score.
- Supporting quotes occur in the referenced transcript segments.
- Every referenced speaker exists, and the proposed source matches the original speaker.
- A name has evidence from that speaker. A merge has evidence from every source and target. An utterance correction has evidence in the affected utterance and from the target speaker.
- Proposals do not conflict. Cyclic or chained merges, intersecting merges and simultaneous speech are left for review.
- Duplicate names are checked after anonymous labels have been resolved to their proposed names or roles.

Question-and-answer order, shared roles, similar speaking styles and topic continuity can suggest a correction, but are not enough to apply one automatically. A lecturer may answer their own question. A short response may come from someone other than the person just addressed.

These checks verify the proposal's references and consistency. They do not independently prove a person's identity. The model can still misinterpret a quote, so use the recording to check consequential speaker assignments.

## Using the transcript view

The transcript tab opens the corrected version once the speaker attribution stage completes. It shows how many proposals were applied and how many need review.

- **검토 필요:** the proposal was not applied. The current speaker label is retained.
- **보정됨:** the displayed speaker or name includes an accepted correction.
- **검토 필요한 발언만 보기:** filters to utterances associated with unresolved proposals.
- **화자 보정 근거:** shows the proposed change, reason, verified quotes and any failed checks. Use the playback link to hear the evidence.
- **원본 전사:** displays the original acoustic labels for comparison. Switching versions keeps the audio player in place.

Unknown names remain anonymous. A possible name is shown as a candidate, not as the participant's established name. The existing participant-name editor in the summary tab can confirm a display name. Confirming a name clears its name-review flag; it does not resolve a disputed utterance assignment. Individual merge and utterance proposals are read-only in this release.

Name reviews appear once per speaker. They do not mark every utterance as uncertain. The transcript tool returns the relevant speakers' name-review status separately from utterance assignment warnings, and search documents carry the same distinction. Evidence cards display these as `이름 검토 필요` or `화자 검토 필요`.

## Stored results

The original JSON stays at `transcripts/{meetingId}/transcript.json`. The reviewed copy is written to `results/{meetingId}/transcript_attributed.json`.

The copy preserves segment IDs, words, word timestamps, segment timestamps and text. It adds the original speaker, the displayed label, correction references and a review flag. `speakerAttribution.version` is `2`; its `corrections` list records both applied and unresolved proposals. The speaker attribution stage output includes only accepted merges and relabels, with unresolved proposals in `reviewItems`.

Later meeting-analysis stages read the corrected transcript and are instructed to keep uncertain identities provisional. Finalization writes the same labels and review markers into the Markdown transcript used by the knowledge base. The chat tool that reads exact transcript windows also uses the corrected file and carries its review markers into the answer context. The original JSON is kept for comparison.

The result API checks that the attribution stage completed and its output exists before returning a corrected URL. Missing files fall back to the original. Storage permission and service failures are reported instead of silently switching data. The response includes an object revision so regenerating the same S3 key refreshes the browser cache. An expired transcript download URL is renewed once through the authenticated API.

Audio errors also request a fresh download URL and restore the playback position. Automatic recovery is limited; a reconnect button is shown if another attempt is needed. Background session renewal keeps the current page mounted so it does not discard drafts or interrupt playback.

Title changes, speaker edits and final document publication share a per-meeting DynamoDB lock. A conflicting API save returns HTTP 409 and can be retried. Finalization retries contention without repeating the analysis stages. The ten-minute lock lifetime exceeds the API's 29-second and Finalize's five-minute Lambda timeouts; keep writer timeouts below that lifetime. Edits preserve the document key on older meetings.

## Updating and checking an installation

Use the existing [update procedure](deployment.md#updating-an-installation). This change updates the Agent and Chat runtimes, Pipeline, API and Web bundles. It does not require new secrets, STT model downloads or a new search connector.

Newly analyzed meetings receive review metadata. Existing results are not rewritten by deployment. Older corrected transcripts remain readable and show a notice that per-utterance review information is unavailable. If a meeting has no corrected file, the original remains available. Lecture study uses its existing transcription flow; this correction stage belongs to meeting analysis.

After deployment:

1. Upload a short meeting with two people introducing themselves and exchanging questions.
2. Open the transcript during processing. Check that it switches from the original to the corrected file when speaker attribution completes.
3. If review items appear, inspect the reasons and play the referenced speech. Confirm that unapplied utterance proposals retain their original speaker.
4. Switch between corrected and original views during playback. Check the words, timestamps and playback position.
5. Change a participant name in the summary and check the transcript label. Any separate utterance review should remain visible.
6. Open an older meeting to check compatibility.

Local tests cover proposal validation, unchanged source data, API ownership and fallback, cache refresh, expired URLs, review controls, audio seeking, and the knowledge-base transcript. Actual diarization accuracy and model decisions must be evaluated with representative recordings in the deployed environment.
