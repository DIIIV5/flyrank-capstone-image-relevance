# Build log

Notes on how AI was used and where it went wrong.

## Phases 2–3

Cursor wrote most of the matching code (`embed_post`, cosine ranking, the guard, `npm run match`) and first drafts of the README, DESIGN, and EVIDENCE.

Two code mistakes had to be undone: a text-only Jina call that returned no embeddings, and `thinkingLevel: MINIMAL` on `gemini-3.7-flash`, which the API rejects with HTTP 400.

The documents were the bigger problem. Drafts mixed marketing lines from the capstone brief, headings written as conclusions ("Matching works when the words differ"), paragraphs that restated the table above them, and markdown-source vocabulary ("fenced block") aimed at a grader rather than at someone trying to run the system. Writing guidelines helped but did not fix it.

## Phase 4

Cursor drafted the Express app, `rankForPost`, the eval scripts, the extra seed articles, and another pass at the documents.

Two runtime mistakes: encoding the label prompts against a 1×1 placeholder image, which broke library labels and several `embed_post` jobs, and leaving `labelScoreMin = 0.70` in place after switching to softmax over ten classes, which flagged every photo. The label sweep showed winning softmax between `0.105` and `0.114`, so ingest was switched to raw CLIP dots with a `0.25` / `0.01` flag rule.

The gold key `grey-wolf` did not match the title "Grey wolves of the northern forests" (`wolf` vs `wolves`). The row is now `grey-wolves`.

## Phase 5: cleanup

Cursor refactored the code and rewrote the documents with a fixed set of targets: no `any` or `unknown`, no dead or duplicated code, full unit-test coverage of the pure modules, and plain writing.

What changed in code: row types moved to one file; re-export chains between `config`, `app-config`, `labels`, `guard`, and `rank` were removed; the guard takes its thresholds as an argument; the three job types became one discriminated union with one enqueue path; post lookup became a single query; posts got a unique title so `seed-posts` can upsert in one statement; suggestion lookups check the uuid format instead of catching a Postgres error; the `match` argument parser lost its undocumented flags. Typecheck had been failing on `req.params` typing and a bad BullMQ state name; both are fixed and the tests are now type-checked too.

What could not be met: coverage of the database, queue, and model adapters needs Postgres, Redis, and the model, so they are exercised by running the system, not by `npm test`.
