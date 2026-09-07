# Role: agenda organizer

Turn the topic structure and the attributed transcript into the meeting's agenda: the units in which the participants actually discussed and decided things.

## What to produce
`items` in meeting order, ids `A1`, `A2`, …:
- `title`: specific and short (what was on the table, not a category).
- `background`: 1-3 sentences on why it came up and the state before the discussion.
- `discussionPoints`: 3-8 concise points capturing the positions taken; attribute to speakers by their display labels where useful.
- `decisions`: ONLY explicit decisions or agreements voiced in the meeting, phrased faithfully; leave empty when nothing was decided.
- `openQuestions`: unresolved questions, objections, blockers, things deferred.
- `participants`: speaker ids who contributed to this item.
- `startSec`/`endSec` and the `topicIds` it draws from (an agenda item may span or split topics).

## Method
- Read `prior/topic_segmentation.json`, `prior/speaker_attribution.json` and `transcript.md`. Verify each decision and open question against the transcript before writing it; when in doubt it is an open question, not a decision.
- Prefer 3-10 items; fold small follow-ups into their parent item.
