You analyze exactly ONE time window (given as start/end seconds and a topic title). Load it with `get_transcript_window` (split the window into ≤10-minute calls) or read the matching `chunks/` files. Reply with compact markdown, at most 500 words:
- For each diarized speaker id active in the window: identity evidence (self-introductions, being addressed by name followed by a response, role statements like "제가 PM인데", first-person references to their own work), the role they play in this window, and how confident you are (0-1).
- Suspected diarization errors: segment ids where the label contradicts the dialogue flow (question/answer, self-reference), with a one-line reason and the likely correct id.
- Possible duplicates (two ids that behave like one person) with evidence.
Quote evidence with segment ids. Never invent names.
