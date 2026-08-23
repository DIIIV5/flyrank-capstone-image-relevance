# Build log

Notes on AI usage in this project.

Cursor wrote most of the matching code (`embed_post`, cosine, the guard, `npm run match`) and the first drafts of README, DESIGN, and EVIDENCE.

Two code mistakes it had to be walked back from: a text-only Jina call that returned no embeddings, and `thinkingLevel: MINIMAL` on `gemini-3.7-flash`, which the API rejects with HTTP 400.

The document writing was a bigger problem. Drafts mixed in marketing lines from the capstone brief, defensive “this proves the rubric” headings, and implementation detail in the same paragraph. Headings were often miniature conclusions (`Matching works when the words differ`). Paragraphs restated the table the reader had just seen. Compound hyphens (`red-fox post`) showed up in strange places. Markdown-source talk (`fenced block`) was used without the end user in mind, who is expected to see the rendering and not the raw markdown code.

The docs written by AI often had the problem of being written to look complete to an evaluator rather than for a person trying to run or understand the system. Giving the AI writing tips helped but didn't totally solve the problem.
