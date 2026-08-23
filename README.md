# flyrank-capstone-image-relevance

> **Incomplete**

A backend that matches images to text, used to recommend photos when confidence is high enough.

## Status

Phases 1–3 are in the repo (schema, jobs, ingest/annotate, matching). Review API and eval are not done yet.

| Phase                   | Status                                 |
| ----------------------- | -------------------------------------- |
| 1 Design                | Done — see [DESIGN.md](docs/DESIGN.md) |
| 2 Image understanding   | Done                                   |
| 3 Matching + guard      | Done — see `npm run match`             |
| 4 Review / tests / eval | Unit tests only                        |
| 5 Demo                  | Not started                            |

## What it does (in progress)

1. Batch of images are given labels and embeddings (`npm run ingest`).
2. Gemini writes tags and alt text (`npm run annotate`). Alt text is stored in `images.caption`.
3. A post's title and body are encoded by the same Jina text tower (`npm run seed-posts`).
4. `npm run match` ranks stored image vectors by cosine and runs the mismatch guard.
5. If no candidate is suggested, the script writes `no_confident_match` with reasons.
6. Later: the user can approve or reject a suggestion. Suggestions include the stored alt text.

## Architecture

```text
Images ──► BullMQ worker ──► Jina CLIP v2 ──► labels + image vectors ──► Postgres
Images ──► BullMQ worker ──► Gemini ──► tags + alt text (caption) ─────┘
Posts  ──► BullMQ worker ──► Jina CLIP v2 ──► post vectors ───────────────┘
                                                                      ▼
                                                         rank → mismatch guard
                                                              /            \
                                                         suggest          reject + reason
```

The layers are HTTP, jobs, AI adapters, and Postgres. HTTP is not built yet. Model work is done in jobs.

## Setup

Requires Docker Desktop, Node.js 24+, and a Gemini API key (AI Studio).

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
```

Put a real `GEMINI_API_KEY` in `.env`. Do not share your `.env`.

`.env` must match Compose:

- `DATABASE_URL=postgres://flyrank:flyrank@localhost:5433/flyrank`
- `REDIS_URL=redis://localhost:6380`
- `GEMINI_MODEL=gemini-3.7-flash`

Use `localhost`.

## Run

Start the worker in its own terminal and leave it. First start downloads Jina weights. Stop it with Ctrl+C in that terminal. Restart it after changing `.env`, `src/config.ts`, or `src/jobs.ts`.

```bash
npm run worker          # leave running
npm run ingest          # Jina labels + embeddings for data/images/
npm run annotate        # enqueue Gemini jobs; the worker writes tags and caption
npm run seed-posts      # insert data/posts/*.md and enqueue embed_post
npm run match -- red-fox
npm run match -- red-fox grey-wolf-01.jpg
npm run match -- coral-bleaching
```

`npm run match` takes a post id or title slug, then an optional image filename. A second argument runs the guard on that pair only (Probe 3). npm on Windows drops `--flag` arguments, so the script reads those values as positionals. API: not implemented yet.

## Tests and eval

`npm test` checks the JSON schema, the flag rule, cosine, and the guard. It does not call the model.

```bash
npm test
```

Eval: not implemented yet.

## Limitations

- Labels are a closed set (`fox`, `wolf`, `dog`, `cat`, `big cat`, `bear`, `deer`, `other`). A bison should be classified as `other` or `flagged`.
- Zero-shot scores are not calibrated probabilities. Ingest marked every photo `flagged` (`0.70` / `0.15` in [src/labels.ts](src/labels.ts)), so guard check 2 is off.
- The cosine floor of `0.25` was picked to match the scale of image-to-text CLIP scores. It is not measured.
- Gemini `confidence` does not set `images.status` and does not affect rank.

## License

`MIT`
