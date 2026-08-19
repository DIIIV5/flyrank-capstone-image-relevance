# flyrank-capstone-image-relevance

> **In Progress**

A backend that matches images to text, use to recommend photo's when confidence is high enough.

## Status

Phases 1–2 are in the repo (schema, jobs, ingest/annotate). Matching, review API, and eval are not done yet.

| Phase                 | What to write here when it ships  |
| --------------------- | --------------------------------- |
| 1 Design              | Done                              |
| 2 Image understanding | Mostly done - still needs testing |

| 3 Matching + guard
| 4 Review / tests / eval
| 5 Demo |

## What it does

1. Batch are given alt text, labels and embeddings.
2. A post (request) and image are compared and ranked.
3. The mismatch guard rejects images with low confidence.
4. If no images meet the confidence threshhold, the api returns 'no confident match'
5. The user can approve or reject a suggestion.
6. Suggestions include the stored alt text.

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

The layers are HTTP, jobs, AI adapters, and Postgres. Model work is done in jobs. The api never calls the model.

## Setup

Requires Docker Desktop, Node.js 24+, and a Gemini API key (AI Studio, free tier, no credit card).

```bash
cp .env.example .env # Put your real GEMINI_API_KEY in .env. Do not share it.
docker compose up -d
npm install
npm run migrate
```

## Run

```bash
npm run worker          # leave this running (first start downloads weights)
npm run ingest          # embed + label every photo in data/images/
npm run annotate        # Gemini alt text and tags; invalid JSON is retried, never stored
```

\*\*TODO — seed (Phase 4/5).

`not implemented yet`.

**TODO — API (Phase 4).**

`not implemented yet`

## Tests and eval

```bash
npm test
```

**TODO — eval command** (Phase 4)

`not implemented yet`

## Limitations

`not implemented yet`

## License

`MIT`
