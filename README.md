# flyrank-capstone-image-relevance

## What this software does

This software picks a photo for an article when the match is clear, and refuses it when the match is not. A fox article gets a fox photo, a wolf photo for that article is refused, and an article about coral is refused outright when no photo fits.

How the system is built: [docs/DESIGN.md](docs/DESIGN.md).

## What you need

- Docker Desktop
- Node.js 24 or later
- A Gemini API key from AI Studio

Photos are not in git, so after you clone the repo, `data/images` may be empty except for `eval/` and `test/`. Add your own `.jpg`, `.jpeg`, `.png`, or `.webp` files there.

## Start the system

Copy `.env.example` to `.env`.

Put your Gemini key in `.env`. Keep the key private.

Set these values in `.env`. Use `localhost`. Use port `5433` for Postgres. Use port `6380` for Redis.

```text
DATABASE_URL=postgres://flyrank:flyrank@localhost:5433/flyrank
REDIS_URL=redis://localhost:6380
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.7-flash
PORT=3000
```

Start Postgres and Redis:

```bash
docker compose up -d
npm install
npm run migrate
```

Leave Docker running.

Start the worker in a second terminal. Leave it running.

```bash
npm run worker
```

The first worker start downloads the image-model files. This can take several minutes.

Restart the worker after you change `.env` or `config.yaml`.

## Put photos and articles

This software uses three kinds of files: library photos, name-check photos, and articles.

### Library photos (`paths.corpus`, default `data/images`)

- Put files in this folder. Do not put them in a subfolder.
- `npm run ingest` reads those files only.
- If a name in `labels` has no library photo, copy one file from that name's folder under `paths.label_eval`. Leave the original in place.

### Name-check photos (`paths.label_eval`)

- Each name in `labels` has a folder of photos that should all be that name.
- These folders are for `npm run eval-labels`.
- Keep them out of the library folder.

### Articles (`paths.posts`)

Each article is a Markdown file with front matter:

```markdown
---
title: The behaviour of red foxes
expected_label: fox
---

Article body here.
```

- `title` is required.
- `expected_label` is optional. If set, it must be a name in `labels`.
- Omit `expected_label` on articles that should match nothing, such as coral or machinery.
- `npm run match -- red-fox` finds an article by uuid, by exact title, or by a hyphen form of words in the title. `grey-wolf` will not find "Grey wolves…". Use a string that appears in the title, such as `grey-wolves`, or use the uuid printed by `match`.

### Load photos and articles

```bash
npm run ingest
npm run annotate
npm run seed-posts
```

These commands queue jobs, so the worker must be running. Wait until it has finished those jobs before you run `match`.

- `ingest` names photos and stores image scores.
- `annotate` writes tags and alt text.
- `seed-posts` writes articles and stores article scores.

## Match one article

```bash
npm run match -- red-fox
npm run match -- red-fox grey-wolf-01.jpg
npm run match -- coral-bleaching
```

- `red-fox`: the fox photo ranks first and a decision is suggested, while the wolf photo is refused with a reason.
- The second command tests only the wolf file, which is refused.
- `coral-bleaching`: no photo is suggested, because the similarity is too low.

On Windows, put extra arguments after `--` as words, not as `--flag`. `npm run match -- --post=red-fox` also works.

`match` saves its suggestions, the same as a POST request. Review uses these saved suggestions.

## Save and review

1. Start the review API in a third terminal. Leave the worker running.

   ```bash
   npm run serve
   ```

2. Show suggestions for an article. This does not save them.

   ```bash
   curl http://localhost:3000/posts/red-fox/images
   ```

3. Save suggestions so you can approve or reject them.

   ```bash
   curl -X POST http://localhost:3000/posts/red-fox/images
   ```

4. Copy the `id` from the saved JSON.

5. Open that suggestion.

   ```bash
   curl http://localhost:3000/suggestions/<id>
   ```

6. Approve it.

   ```bash
   curl -X POST http://localhost:3000/suggestions/<id>/review -H "Content-Type: application/json" -d "{\"review\":\"approved\"}"
   ```

You can approve only a row that was suggested. A refused row, or a row where no photo fit, is rejected.

Add `?image=grey-wolf-01.jpg` to test one file:

```bash
curl "http://localhost:3000/posts/red-fox/images?image=grey-wolf-01.jpg"
```

Saving new suggestions for an article replaces its earlier suggestions, including any that were already approved or rejected.

## Change names and scores

### Add a name

1. Add the name to `labels` in [config.yaml](config.yaml).
2. Add a folder of photos for that name under `paths.label_eval`.
3. Put at least one photo of that name as a file in the library folder.
4. Restart the worker.
5. Run `reset-embed-images`, then `ingest`. Stored names used the old list.

### What the numbers mean

- `score_scale`: how the image-name score is stored, `raw` or `softmax`. Default in this repo is `raw`.
- `label_score_min` / `label_margin_min`: how sure the name must be. Below that, the photo is treated as uncertain.
- `cosine_min`: the lowest article-photo similarity that still counts as a match.
- `check_flagged`: refuse uncertain photos.
- `catch_all`: a name, usually `other`, skipped when comparing Gemini's subject word to the image name.
- `label_prompts`: optional. Default is `a photo of a {label}`.

See [config.yaml](config.yaml) for the full file.

## Measure, then write the numbers

### Name check — `npm run eval-labels`

- Scores every photo in the `paths.label_eval` folders.
- Reports how often the top name matches the folder name.
- Prints grids. Pick `score_scale`, `label_score_min`, and `label_margin_min` from a grid cell that keeps correct names and flags confused ones.
- Paste the values into `config.yaml`. If `score_scale` changed, run `reset-embed-images` then `ingest`.

### Article check — `npm run eval`

- For each row in the article-to-photo list (`paths.matching_gold`, default [data/eval/labels.json](data/eval/labels.json)), ranks library photos.
- Counts how often the top suggested file is the file named in that list. `image: null` means no photo should be suggested.

  ```json
  { "post": "red-fox", "image": "some-file.jpg" }
  { "post": "coral-bleaching", "image": null }
  ```

- `post` must find the article the same way `match` does: by title words, not necessarily the markdown filename.

The script prints:

```text
Top-1 precision: 95% on 20 labeled posts
```

That line is from `data/eval/labels.json` after the last local run. Measure again after you change the list, the photos, or the numbers.

`cosine_min` is `0.25` in the committed config, because `0.28` lowered this score on that list.

## Commands

- `npm run worker` — Run image-model and Gemini jobs.
- `npm run ingest` — Name and score files in `paths.corpus`.
- `npm run annotate` — Write Gemini tags and alt text.
- `npm run seed-posts` — Insert articles from `paths.posts` and store their scores.
- `npm run match` — Rank library photos for one article.
- `npm run serve` — Start the review API on port 3000.
- `npm run eval` — For each article in the article-to-photo list, rank library photos. Print how often the top photo is the named photo.
- `npm run eval-labels` — Score photos in `paths.label_eval`. Report how often the top name matches the folder.
- `npm run reset-embed-images` — Clear stored image scores so `ingest` runs again.
- `npm test` — Check the schema, guard, similarity math, and HTTP handlers.
- `npm run migrate` — Apply SQL migrations.

## Limits

- The review API listens on this computer only.
- Photos are not stored in git. You supply the library files.
- Rank uses photo-article similarity. Gemini writes tags and alt text.
- On Windows, pass extra npm arguments as words after `--`.

## License

MIT
