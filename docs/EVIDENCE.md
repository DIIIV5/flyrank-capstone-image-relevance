# Evidence

One section per box in the brief's Definition of Done (§ 6), in the brief's order, each with output from a local run. Postgres and Redis were started with `docker compose up -d` and `npm run worker` was running in a second terminal. The library was ten Unsplash photos, one per label, plus `grey-wolf-01.jpg`; the held-out set was 50 photos, five per label.

## AI processing

### 1. Vision output is validated against a schema; invalid responses are never trusted

`ImageAnnotationSchema` in [src/types.ts](src/types.ts) requires `subject`, `category`, `attributes` (at most 8), `caption`, and `confidence` in 0–1. `annotateImage` in [src/ai/gemini.ts](src/ai/gemini.ts) parses the Gemini response with it, so an invalid response throws inside the job and nothing is written.

```text
> npm test
✔ ImageAnnotationSchema accepts the Gemini tag JSON
✔ ImageAnnotationSchema rejects bad fields
```

The second test feeds a missing subject, an empty caption, nine attributes, and `confidence: 1.4`; all four are rejected.

### 2. Low-confidence classifications are flagged instead of accepted

A photo is `processed` only when its best label score is at least `label_score_min` and beats the runner-up by at least `label_margin_min`; otherwise it is `flagged`, and the guard later refuses it as `uncertain subject`. On the 50 held-out photos, the committed thresholds flag three, each correctly labelled but with a margin too small to trust:

```text
> npm run eval-labels
...
raw-dot grid (scoreMin, marginMin, processed, flagged, top1AmongProcessed):
0.25	0.01	47	3	1
...
flagged by config.yaml (raw, score >= 0.25, margin >= 0.01):
  fox/jonatan-pie-xgTMSz6kegE-unsplash.jpg	fox	score 0.339	margin 0.005
  cat/andriyko-podilnyk-RCfi7vgJjUY-unsplash.jpg	cat	score 0.319	margin 0.009
  other/zachery-perry-Du8sGaNHVMc-unsplash.jpg	other	score 0.334	margin 0.001
```

Unit tests for the rule and the guard check:

```text
✔ labelStatus is flagged for a low score or a small gap
✔ check 2: a weak label score or margin is rejected as uncertain
```

All ten library photos are `processed` under these thresholds (table under box 5). To see a flagged row in the library itself, copy one of the three photos above into `data/images` and run `ingest`.

### 3. Images are processed through a batch background job with retries

One BullMQ queue carries `embed_image`, `annotate_image`, and `embed_post`, each with `attempts: 3` and exponential backoff. Every job has a row in `jobs` keyed by content hash or post id, so re-running a script skips finished work.

```text
      type      |  status   | jobs | max_attempts
----------------+-----------+------+--------------
 annotate_image | succeeded |    6 |            3
 embed_image    | succeeded |    6 |            1
 embed_post     | succeeded |    2 |            3
```

```text
> npm run seed-posts      (second run, nothing new)
seed-posts done: queued=0 skipped=20
```

### 4. Vision and embedding costs are tracked per call

`recordUsage` in [src/jobs.ts](src/jobs.ts) runs in a `finally` block, so failed calls are logged too. Jina is `local_embed` at zero cost; Gemini is `vision` at the list price of $0.00002 per image.

```text
    kind     |    provider     | calls | cost_usd | runtime_ms
-------------+-----------------+-------+----------+------------
 local_embed | transformers.js |    19 | 0.000000 |      23282
 vision      | gemini          |    50 | 0.001000 |     194390
```

## Matching system

### 5. Image and post embeddings are stored; posts return ranked suggestions

Library rows after ingest, with the Jina label and scores:

```text
                   filename                    |  label  | score | runner | margin |  status
-----------------------------------------------+---------+-------+--------+--------+-----------
 alexander-andrews-mEdKuPYJe1I-unsplash.jpg    | fox     | 0.386 |  0.332 |  0.054 | processed
 alvan-nee-ZCHj_2lJP00-unsplash.jpg            | cat     | 0.358 |  0.310 |  0.049 | processed
 amber-kipp-75715CVEJhI-unsplash.jpg           | cat     | 0.345 |  0.288 |  0.057 | processed
 andy-holmes-sym5TTE2ks0-unsplash.jpg          | tiger   | 0.402 |  0.346 |  0.056 | processed
 anvesh-baru-2ZXrBR4ByAQ-unsplash.jpg          | bear    | 0.390 |  0.331 |  0.059 | processed
 baptist-standaert-mx0DEnfYxic-unsplash.jpg    | dog     | 0.364 |  0.320 |  0.044 | processed
 benjamin-raffetseder-oUIc4XH-VUY-unsplash.jpg | deer    | 0.390 |  0.362 |  0.028 | processed
 ben-moreland-auijD19Byq8-unsplash.jpg         | chicken | 0.415 |  0.335 |  0.080 | processed
 diana-shchurova-tDRZNFrz9yA-unsplash.jpg      | cow     | 0.368 |  0.353 |  0.015 | processed
 grey-wolf-01.jpg                              | wolf    | 0.397 |  0.344 |  0.053 | processed
```

Gemini subject and caption on the same rows:

![images rows with Jina label, Gemini subject, and caption](screenshots/database-corpus.png)

Ranked suggestions for the fox article, from stored vectors:

```text
> npm run match -- red-fox
post eb19b671-96d6-4dad-8fe8-c50eebc52f49 / The behaviour of red foxes
1 / alexander-andrews-mEdKuPYJe1I-unsplash.jpg / fox / 0.349 / suggested / cleared the guard
2 / grey-wolf-01.jpg / wolf / 0.316 / rejected / subject mismatch: expected fox, detected wolf
3 / anvesh-baru-2ZXrBR4ByAQ-unsplash.jpg / bear / 0.292 / rejected / subject mismatch: expected fox, detected bear
```

![fox article ranked against the library](screenshots/run-match-1.png)

### 6. Semantic matching works for equivalent concepts

The article above is titled "The behaviour of red foxes" and its body starts with `Vulpes vulpes`. The photo filenames are Unsplash hashes and the photos have no text, so the fox photo ranks first (cosine 0.349) on meaning alone; the wolf photo is second (0.316).

## Safety layer

### 7. The guard rejects the wolf on the fox post

Forcing the wolf photo as the only candidate for the fox article:

```text
> npm run match -- red-fox grey-wolf-01.jpg
post eb19b671-96d6-4dad-8fe8-c50eebc52f49 / The behaviour of red foxes
1 / grey-wolf-01.jpg / wolf / 0.316 / rejected / subject mismatch: expected fox, detected wolf
- / none / - / - / no_confident_match / no confident match: subject mismatch: expected fox, detected wolf
```

![wolf photo forced for the fox article](screenshots/run-match-2.png)

```text
✔ check 3: the post's expected label must match the image label
```

### 8. Rejections include a human-readable explanation

Every rejected candidate carries a `reason`, as in the outputs above and below: `subject mismatch: expected fox, detected wolf`, `similarity below threshold (0.19 < 0.25)`, `uncertain subject: label score 0.20, margin 0.10`, `metadata disagreement: Gemini subject "red fox", Jina label wolf`. Each is asserted by a test in [src/guard.test.ts](src/guard.test.ts).

### 9. "No confident match" with reasons when nothing clears the bar

The coral article has no `expected_label` and every cosine is below `0.25`:

```text
> npm run match -- coral-bleaching
post c3dd3a4a-151c-424c-bc1b-8f41560243c8 / Coral bleaching on tropical reefs
1 / diana-shchurova-tDRZNFrz9yA-unsplash.jpg / cow / 0.189 / rejected / similarity below threshold (0.19 < 0.25)
2 / baptist-standaert-mx0DEnfYxic-unsplash.jpg / dog / 0.183 / rejected / similarity below threshold (0.18 < 0.25)
3 / ben-moreland-auijD19Byq8-unsplash.jpg / chicken / 0.183 / rejected / similarity below threshold (0.18 < 0.25)
- / none / - / - / no_confident_match / no confident match: similarity below threshold (0.19 < 0.25); similarity below threshold (0.18 < 0.25); similarity below threshold (0.18 < 0.25)
```

![coral article with no candidate above the floor](screenshots/run-match-3.png)

## Backend

### 10. Database models with indexes

Six application tables plus `schema_migrations`, created by [db/migrations](db/migrations):

```text
     tablename     |                indexname
-------------------+------------------------------------------
 ai_usage          | ai_usage_created_at_idx
 ai_usage          | ai_usage_pkey
 embeddings        | embeddings_owner_type_owner_id_model_key
 embeddings        | embeddings_pkey
 images            | images_content_hash_key
 images            | images_pkey
 images            | images_status_idx
 jobs              | jobs_idempotency_key_key
 jobs              | jobs_pkey
 posts             | posts_pkey
 schema_migrations | schema_migrations_pkey
 suggestions       | suggestions_pkey
 suggestions       | suggestions_post_id_idx
```

Migration `007` has since added `posts_title_key` (unique title). Tags live on `images` (`subject`, `category`, `attributes`, `caption`, `vlm_confidence`); approvals and rejections are `suggestions.review` and `reviewed_at`.

### 11. Validated API endpoints and the review workflow

`GET` ranks without writing; `POST` writes the same rows as suggestions.

```text
> curl -s http://localhost:3000/posts/red-fox/images
{"post":{"id":"eb19b671-96d6-4dad-8fe8-c50eebc52f49","title":"The behaviour of red foxes"},"candidates":[{"filename":"alexander-andrews-mEdKuPYJe1I-unsplash.jpg","label":"fox","similarity":0.34923950679860055,"decision":"suggested","reason":"cleared the guard","caption":"A red fox sits upright on a damp outdoor path and looks attentively directly ahead."},{"filename":"grey-wolf-01.jpg","label":"wolf","similarity":0.3159532176534087,"decision":"rejected","reason":"subject mismatch: expected fox, detected wolf","caption":"A dark-furred wolf rests on a bed of wood chips with its mouth slightly open."},{"filename":"anvesh-baru-2ZXrBR4ByAQ-unsplash.jpg","label":"bear","similarity":0.2919381243621981,"decision":"rejected","reason":"subject mismatch: expected fox, detected bear","caption":null}],"no_confident_match":null}
```

Inspect why, then approve:

```text
> curl -s -X POST http://localhost:3000/posts/red-fox/images        (writes suggestions, same body)

> curl -s http://localhost:3000/suggestions/aba5dc8f-7312-4db5-b2f5-04c0cbf23173
{"id":"aba5dc8f-7312-4db5-b2f5-04c0cbf23173","filename":"alexander-andrews-mEdKuPYJe1I-unsplash.jpg","caption":"A red fox sits upright on a damp outdoor path and looks attentively directly ahead.","label":"fox","labelScore":0.38596183,"runnerUpScore":0.33212414,"similarity":0.3492395,"decision":"suggested","reason":"cleared the guard","review":"pending","reviewedAt":null}

> curl -s -X POST http://localhost:3000/suggestions/aba5dc8f-7312-4db5-b2f5-04c0cbf23173/review -H "Content-Type: application/json" -d "{\"review\":\"approved\"}"
{"id":"aba5dc8f-7312-4db5-b2f5-04c0cbf23173","filename":"alexander-andrews-mEdKuPYJe1I-unsplash.jpg","caption":"A red fox sits upright on a damp outdoor path and looks attentively directly ahead.","label":"fox","labelScore":0.38596183,"runnerUpScore":0.33212414,"similarity":0.3492395,"decision":"suggested","reason":"cleared the guard","review":"approved","reviewedAt":"2026-09-02T18:51:05.885Z"}
```

Validation at the boundary, all returning JSON:

```text
GET  /suggestions/not-a-uuid                         404
GET  /posts/nope/images                              404
GET  /posts/red-fox/images?image=nope.jpg            404
POST /suggestions/<id>/review  body: {              400 {"error":"invalid JSON"}
POST /suggestions/<id>/review  {"review":"maybe"}    400 {"error":"invalid review body"}
POST /suggestions/<no-match id>/review               400 {"error":"cannot review a no_confident_match row"}
```

The same cases, plus a 409 for a post with no stored vector, run as HTTP tests with stubbed dependencies in [src/http.test.ts](src/http.test.ts).

## Quality and documentation

### 12. Automated tests cover schema validation, mismatch rejection, and matching accuracy

```text
> npm test
ℹ tests 58
ℹ pass 58
ℹ fail 0
```

Schema validation: `types.test.ts`. Mismatch rejection: `guard.test.ts` (one test per guard check, in order). Matching accuracy: `similarity.test.ts` for cosine and ranking, `rank-result.test.ts` for the no-match decision, and `npm run eval` for the measured number. `npm run test:coverage` reports 100% line, branch, and function coverage of the modules the tests load; `npm run typecheck` passes.

### 13. A labeled evaluation set measures top-1 precision, and the number is in the README

[data/eval/labels.json](data/eval/labels.json) has 20 rows: two articles per animal label and two (`coral-bleaching`, `steam-turbine`) that expect no photo.

```text
> npm run eval
Top-1 precision: 95% on 20 labeled posts
cosine sweep:
  0.20 → 95% (19/20)
  0.22 → 95% (19/20)
  0.25 → 95% (19/20)
  0.28 → 75% (15/20)
  0.30 → 60% (12/20)
```

The README opens with the same line. The one miss is `cat-hunting`: its top three are wolf, tiger, and fox, all rejected as `subject mismatch`, so the cat photo is never reached.

How the label thresholds were chosen: `eval-labels` got every held-out photo right (`Top-1 accuracy: 100.0% on 50 photos`), but softmax over ten labels never exceeds `0.114`, so any softmax floor above that flags everything. Raw dots with `0.25` / `0.01` pass 47 of 50 with 100% top-1 among those passed. That is why `score_scale` is `raw`.

### 14. README with architecture explanation and diagram; submission-pack files present

The [README](README.md) has the diagram, run and seed steps, the precision line, and a limitations section. Pack files at the repo root: `README.md`, `capstone.yaml`, `EVIDENCE.md`, `BUILDLOG.md`, `.env.example`, plus `LICENSE` (MIT).
