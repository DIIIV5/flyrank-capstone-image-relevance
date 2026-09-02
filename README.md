# flyrank-capstone-image-relevance

Picks a library photo for an article when the match is clear and refuses it when it is not. A fox article gets the fox photo, the wolf photo is refused with a reason, and an article about coral gets no photo at all.

```text
Top-1 precision: 95% on 20 labeled posts
```

That line is what `npm run eval` prints for the committed config and gold file; see [Change labels or thresholds](#change-labels-or-thresholds).

## Architecture

```text
photo   ─(worker job)─► Jina CLIP v2 ─► label + scores + image vector ─► Postgres
photo   ─(worker job)─► Gemini       ─► subject, tags, caption         ─► Postgres
article ─(worker job)─► Jina CLIP v2 ─► article vector                 ─► Postgres

GET /posts/:id/images
  └─► rank image vectors against the article vector (cosine, top 3)
        └─► mismatch guard: similarity floor, label confidence,
            expected label, Gemini subject
              ├─► suggested (with reason)
              └─► rejected (with reason) / "no confident match"
                    └─► POST /suggestions/:id/review → approved / rejected
```

Four layers: Express routes (`src/http`), a BullMQ worker that runs the models (`src/jobs.ts`, `src/ai`), pure matching logic (`src/guard.ts`, `src/similarity.ts`, `src/labels.ts`), and Postgres access (`src/db.ts`). Models never run inside a request. Details and the guard rules: [docs/DESIGN.md](docs/DESIGN.md). Command output proving each item of the brief's checklist: [EVIDENCE.md](EVIDENCE.md).

## Requirements

- Docker Desktop
- Node.js 24 or later
- A Gemini API key from AI Studio

Photos are not in git. Add your own `.jpg`, `.jpeg`, `.png`, or `.webp` files under `data/images` (see [Files](#files)).

## Setup

1. Copy `.env.example` to `.env` and put your Gemini key in it. The other values match `docker-compose.yml`.

2. Start Postgres and Redis, install, and migrate:

   ```bash
   docker compose up -d
   npm install
   npm run migrate
   ```

3. Start the worker in a second terminal and leave it running:

   ```bash
   npm run worker
   ```

   The first start downloads the image model, which can take several minutes. Restart the worker after changing `.env` or `config.yaml`.

## Files

Paths are set under `paths` in [config.yaml](config.yaml).

**Library photos** (`paths.corpus`, default `data/images`). Files in this folder, not in subfolders, are the photos the system can suggest. Each label in `labels` needs at least one library photo; copy one from that label's held-out folder if you have nothing else.

**Held-out photos** (`paths.label_eval`). One folder per label, holding photos that are all that label. `npm run eval-labels` uses them to check labelling and choose thresholds. Ingest does not read them.

**Articles** (`paths.posts`, default `data/posts`). Markdown files with front matter:

```markdown
---
title: The behaviour of red foxes
expected_label: fox
---

Article body here.
```

`title` is required. `expected_label` is optional and must be one of `labels`; leave it out for articles that should match nothing, such as coral or machinery.

## Load photos and articles

```bash
npm run ingest
npm run annotate
npm run seed-posts
```

- `ingest` labels each library photo with Jina CLIP and stores its vector.
- `annotate` asks Gemini for tags and alt text.
- `seed-posts` stores each article and its vector.

These commands queue jobs for the worker. Wait for the worker to finish before matching.

## Match one article

```bash
npm run match -- red-fox
npm run match -- red-fox grey-wolf-01.jpg
npm run match -- coral-bleaching
```

The first argument finds an article by id, by exact title, or by hyphenated words that appear in the title (`grey-wolves` finds "Grey wolves of the northern forests"; `grey-wolf` does not). An optional second argument checks one photo instead of ranking the library.

`match` prints the top three photos with a decision and reason, and saves them as suggestions, the same as the POST route below.

## Review API

Start the API in a third terminal:

```bash
npm run serve
```

| Route | What it does |
| --- | --- |
| `GET /posts/:id/images` | Rank the library for an article. Nothing is saved. |
| `POST /posts/:id/images` | Same, then save the rows as suggestions so they can be reviewed. Replaces earlier suggestions for that article, including reviewed ones. |
| `GET /suggestions/:id` | One saved suggestion. |
| `POST /suggestions/:id/review` | Body `{"review":"approved"}` or `{"review":"rejected"}`. Only a row with decision `suggested` can be reviewed. |

Add `?image=grey-wolf-01.jpg` to either `/posts` route to check one photo.

```bash
curl -X POST http://localhost:3000/posts/red-fox/images
curl http://localhost:3000/suggestions/<id>
curl -X POST http://localhost:3000/suggestions/<id>/review -H "Content-Type: application/json" -d "{\"review\":\"approved\"}"
```

The API listens on localhost only and has no authentication.

## Change labels or thresholds

To add a label: add it to `labels` in `config.yaml`, add a held-out folder for it under `paths.label_eval`, put at least one photo of it in the library folder, restart the worker, then run `npm run reset-embed-images` and `npm run ingest` so every photo is relabelled against the new list.

The thresholds are explained in `config.yaml`. Two scripts help choose them:

- `npm run eval-labels` scores every held-out photo, prints the top-1 accuracy and a confusion table, and prints grids showing how many photos each `label_score_min` / `label_margin_min` pair would flag. If you change `score_scale`, re-run `reset-embed-images` and `ingest`.
- `npm run eval` ranks the library for each row of `paths.matching_gold` (default [data/eval/labels.json](data/eval/labels.json)) and prints how often the top suggestion is the expected file. `"image": null` means no photo should be suggested. It also shows the result at a few other values of `cosine_min`.

  ```json
  { "post": "red-fox", "image": "some-file.jpg" }
  { "post": "coral-bleaching", "image": null }
  ```

  `post` is matched the same way as the `match` argument.

With the committed config, the 20-row gold file, and the photos used locally, `eval` prints `Top-1 precision: 95% on 20 labeled posts`. Re-run it after changing the gold file, the photos, or the thresholds, and update the number at the top of this file.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run migrate` | Apply SQL migrations. |
| `npm run worker` | Run the model and Gemini jobs. |
| `npm run ingest` | Label and embed library photos. |
| `npm run annotate` | Write Gemini tags and alt text. |
| `npm run seed-posts` | Store articles and embed them. |
| `npm run match -- <post> [image]` | Rank photos for one article and save suggestions. |
| `npm run serve` | Start the review API on port 3000. |
| `npm run eval` | Top-1 precision on the matching gold file. |
| `npm run eval-labels` | Label accuracy and threshold grids on held-out photos. |
| `npm run reset-embed-images` | Clear stored image vectors so `ingest` relabels everything. |
| `npm test` | Unit tests. No database or model needed. |
| `npm run test:coverage` | Unit tests with a coverage report. |
| `npm run typecheck` | `tsc` over source and tests. |

On Windows, pass script arguments as plain words after `--`.

## Limitations

- The API has no authentication and listens on localhost only.
- Photos are not in git; results depend on the library you supply. The numbers in this README and in EVIDENCE come from a ten-photo library plus 50 held-out photos.
- The eval file has 20 rows. One row (`cat-hunting`) misses because three non-cat photos outrank the cat photo on cosine and are all rejected by the guard.
- "Low confidence" means a weak or narrow Jina label score. Gemini's own `confidence` field is stored but does not affect any decision.
- The guard's subject check only fires when Gemini's subject contains one of the configured labels. `kitten` or `border collie` skip it.
- The Gemini free tier can run out mid-annotate; photos without a caption are still ranked, with `caption: null`.
- The label set is closed. A photo of something outside `labels` gets the nearest label or `other`.

## License

MIT
