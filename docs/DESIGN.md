# Design

The system suggests a library photo for an article when the match is good enough and refuses it when it is not. Ranking is by vector similarity; a guard then rejects pairs that are too weak or whose labels disagree. If nothing survives, the answer is "no confident match". The diagram is in the [README](../README.md#architecture).

Models run in worker jobs, never in HTTP handlers. The HTTP layer reads stored rows and vectors only.

## Labels

`labels` in [config.yaml](../config.yaml) is the closed set of names (`fox`, `wolf`, ..., `other`). Ingest encodes each photo and one prompt per label with Jina CLIP v2, and stores the best and second-best label with their scores:

```json
{
  "label": "fox",
  "score": 0.39,
  "runnerUpLabel": "other",
  "runnerUpScore": 0.33
}
```

`score_scale` chooses whether the stored score is the raw image-text dot product or its softmax. A photo is `processed` when `score >= label_score_min` and `score - runnerUpScore >= label_margin_min`, otherwise `flagged`. Both thresholds are chosen from the grids printed by `npm run eval-labels`.

The same text tower encodes article title and body, so article and image vectors are comparable.

## Tags and alt text

Gemini returns one JSON object per photo:

```json
{
  "subject": "red fox",
  "category": "animal",
  "attributes": ["orange fur", "wild", "forest"],
  "caption": "A red fox standing in a forest",
  "confidence": 0.94
}
```

The response is validated with Zod; an invalid response fails the job, which BullMQ retries up to three times. `caption` is returned as alt text. `subject` is used only by the guard. `confidence` is stored but not used.

## Guard

The top three photos by cosine are checked in order. The first failing check is the rejection reason.

1. Cosine below `cosine_min` → `similarity below threshold`.
2. Label score or margin below `label_score_min` / `label_margin_min` → `uncertain subject`. The thresholds are re-applied from the current config, so changing them does not require a re-ingest. `check_flagged: false` turns this check off.
3. The article's `expected_label` is set and differs from the photo's label → `subject mismatch`.
4. Gemini's `subject` names a configured label that differs from the photo's label → `metadata disagreement`. A subject that names no label (`kitten`, `border collie`) is skipped. A missing subject passes, unless `npm run match` is given `--require-tags`, in which case it is `missing metadata`.

A gap check between the first and second cosine, as described in the brief, is not implemented; no useful gap size was found.

## API

- `GET /posts/:id/images` — rank and guard from stored vectors, return JSON. `?image=<filename>` checks that one photo instead. 404 for an unknown post or filename, 409 if the post has no vector. Writes nothing.
- `POST /posts/:id/images` — the same, then replace the article's rows in `suggestions`, including any already reviewed. Without `?image=`, a `no_confident_match` row is stored when nothing was suggested.
- `GET /suggestions/:id` — one stored row with its photo's caption and scores.
- `POST /suggestions/:id/review` — body `{ "review": "approved" | "rejected" }`. 400 for any other body or for a row whose decision is not `suggested`. Sets `review` and `reviewed_at`.

`:id` for posts accepts a uuid, an exact title, or hyphenated words that appear in the title. The server binds to localhost and has no authentication.

## Database

Six tables: `images`, `posts`, `embeddings`, `suggestions`, `jobs`, and `ai_usage`. Gemini fields live on `images`. `embeddings` stores one `real[]` per owner and model; there is no vector index because the library is small and ranking is done in the process. `jobs` tracks status and attempts under an idempotency key so re-running a script does not repeat finished work. `ai_usage` records every model call with runtime and list price, including failed calls.

Label columns are checked by format only (`^[a-z][a-z0-9_]*$`); the allowed set lives in `config.yaml`.

## Code layout

- `src/app-config.ts` — parse `config.yaml`. `src/config.ts` — environment variables.
- `src/labels.ts`, `src/similarity.ts`, `src/guard.ts`, `src/rank-result.ts`, `src/front-matter.ts` — pure logic, fully unit-tested.
- `src/ai/jina.ts`, `src/ai/gemini.ts` — model adapters.
- `src/db.ts` — all SQL. `src/jobs.ts` — BullMQ queue and worker. `src/rank.ts` — rank one article.
- `src/http/app.ts` — Express routes, built from an injected dependency object so tests run without a database.
- `src/scripts/` — one file per `npm run` command.

Stack: TypeScript, Express, PostgreSQL, Redis, BullMQ, Transformers.js (Jina CLIP v2), Gemini Flash.
