"""Task texts shared by the deck and video analysis paths."""

# Bump when STUDY_TASK changes so cached study entries from the previous wording are regenerated on retry.
STUDY_CACHE_VERSION = "v3"

AUDIENCE_TASK = """Infer who this lecture is for, using only cues in the lecture itself: the title, course name, section titles and concepts, and the opening minutes of recorded speech (course level, references to earlier classes, assumed background, difficulty of the examples). Return in the output language: level (the learner's stage and where this lecture sits in the course, e.g. first-year undergraduate, first lecture of an introductory course), priorKnowledge (3-8 short items the lecturer assumes the learner already knows), lectureGoal (what the learner should be able to do after this lecture). Do not guess personal details of individual students."""

STUDY_TASK = """Create study materials for ONE lecture section in the output language, written for the learner described in `audience`.
- Pitch everything at that level: assume only this lecture's content and the listed prior knowledge; use the lecturer's own notation, terms and examples; never require outside material.
- slideSummary describes what is VISIBLE; spokenSummary describes ONLY the supplied recorded speech; explanation is clearly supplemental teaching that fills the gaps this audience is likely to have.
- Write every equation, symbol and formula in LaTeX in all fields: inline $...$ and display $$...$$.
- mathNotes is REQUIRED whenever the section contains any mathematics: one entry per definition, theorem, lemma or formula, AND one entry per worked example. A worked example is any case where the slide or lecturer checks that a concrete object satisfies a definition or computes a result (verifying field or vector-space axioms for R, Q, C, Z_2, Z_4, F^n or matrices, a counterexample, an operation table, solving an equation): kind example, statement = the claim being checked in LaTeX, steps = every condition or computation checked, one per step, with the actual calculation. statement: the exact statement in LaTeX. steps: the proof, derivation or worked solution as ordered steps, one claim with its justification per step, at the audience level. intuition: how to picture it (geometric meaning, a small concrete example, or a table). If the lecture stated a result without proving it, or checked only some conditions, still give the complete proof or verification and set supplementary to true. explanation may summarize a derivation but must not be the only place it appears: the numbered steps belong in mathNotes. Leave mathNotes empty only for sections with no mathematics at all (title, outline, textbook list, break).
- reviewQuestions (2-4): ordered from basic recall, to understanding, to at most one apply question; tag each with difficulty; each must be answerable from this section by this audience, and answers show the working.
- flashcards (2-5): one fact per card; the front is a term or short question, the back a short answer in the lecturer's words.
- For a title, break or reference-only section, return empty lists instead of filler.
- If recorded speech is empty, spokenSummary MUST be empty. If alignment is uncertain, qualify spokenSummary explicitly.
- Suggest 1-2 focused academic-paper search queries (max 200 characters, no private personal information) for substantive concepts, including cited paper titles or DOIs if visible.
- No invented quotations and no claims about exam coverage."""

VIDEO_STUDY_TASK = STUDY_TASK + """
- Video: slideSummary covers the slide, board work, code demo or speaker scene from the actual video observations. If videoMatched is false, never claim the lecturer discussed this slide."""
