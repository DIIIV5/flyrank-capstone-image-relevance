# flyrank-capstone-image-relevance

> **Incomplete**

A backend that matches images to text, used to recommend photos when confidence is high enough.

## Status

Phases 1–2 are in the repo (schema, jobs, ingest/annotate). Matching, review API, and eval are not done yet.

| Phase | Status |
| --- | --- |
| 1 Design | Done — see [DESIGN.md](docs/DESIGN.md) |
| 2 Image understanding | In progress (ingest/annotate jobs) |
| 3 Matching + guard | Not started |
| 4 Review / tests / eval | Unit tests only |
| 5 Demo | Not started |

## What it does (in progress)

1. Batch of images are given labels and embeddings (`npm run ingest`).
2. Gemini writes tags and alt text (`npm run annotate`). Alt text is stored in `images.caption`.
3. Later: a post and image are compared and ranked.
4. Later: the mismatch guard rejects images with low confidence.
5. Later: if no images meet the confidence threshold, the api returns `no confident match`.
6. Later: the user can approve or reject a suggestion. Suggestions include the stored alt text.

## Architecture

```text
Images ──► BullMQ worker ──► Jina CLIP v2 ──► labels + image vectors ──► Postgres
Images ──► BullMQ worker ──► Gemini ──► tags + alt text (caption) ─────┘
Posts  ──► (later) text encode ──────────────────────────────────────────┘
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

Put a real `GEMINI_API_KEY` in `.env`. Do not commit `.env`.

`.env` must match Compose:

- `DATABASE_URL=postgres://flyrank:flyrank@localhost:5433/flyrank`
- `REDIS_URL=redis://localhost:6380`
- `GEMINI_MODEL=gemini-3.7-flash`

Use `localhost`, not `127.0.0.1`.

## Run

Start the worker in its own terminal and leave it. First start downloads Jina weights. Stop it with Ctrl+C in that terminal. Restart it after changing `.env` or `src/config.ts`.

```bash
npm run worker          # leave running
npm run ingest          # Jina labels + embeddings for data/images/
npm run annotate        # enqueue Gemini jobs; the worker writes tags and caption
```

Seed and API: not implemented yet.

## Tests and eval

`npm test` checks the JSON schema and the flag rule. It does not call the model.

```bash
npm test
```

Eval: not implemented yet.

## Limitations

- Labels are a closed set (`fox`, `wolf`, `dog`, `cat`, `big cat`, `bear`, `deer`, `other`). A bison should be classified as `other` or `flagged`.
- Zero-shot scores are not calibrated probabilities.

## License

`MIT`
