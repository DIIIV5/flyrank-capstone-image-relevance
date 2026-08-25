import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import {
  RankError,
  toRankJson,
  toSuggestionWrites,
  type RankOpts,
  type RankResult,
  type SuggestionWrite,
} from "../rank-result.js";

export type PostRow = {
  id: string;
  title: string;
  body: string;
  expected_label: string | null;
};

export type SuggestionRow = {
  id: string;
  postId: string;
  imageId: string | null;
  filename: string | null;
  caption: string | null;
  label: string | null;
  labelScore: number | null;
  runnerUpScore: number | null;
  rank: number | null;
  similarity: number | null;
  decision: string;
  reason: string;
  review: string | null;
  reviewedAt: Date | null;
};

export const ReviewBodySchema = z.object({
  review: z.enum(["approved", "rejected"]),
});

export type HttpDeps = {
  getPostByTitleOrId: (query: string) => Promise<PostRow | null>;
  rankForPost: (post: PostRow, opts?: RankOpts) => Promise<RankResult>;
  replaceSuggestions: (postId: string, rows: SuggestionWrite[]) => Promise<void>;
  getSuggestionById: (id: string) => Promise<SuggestionRow | null>;
  setSuggestionReview: (
    id: string,
    review: "approved" | "rejected",
  ) => Promise<SuggestionRow | null>;
};

function suggestionJson(row: SuggestionRow) {
  return {
    id: row.id,
    filename: row.filename,
    caption: row.caption,
    label: row.label,
    labelScore: row.labelScore,
    runnerUpScore: row.runnerUpScore,
    similarity: row.similarity,
    decision: row.decision,
    reason: row.reason,
    review: row.review,
    reviewedAt: row.reviewedAt,
  };
}

function queryImage(req: Request): string | null {
  const value = req.query.image;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function createApp(deps: HttpDeps) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const rankHandler = (persist: boolean) =>
    asyncRoute(async (req, res) => {
      const id = req.params.id ?? "";
      const post = await deps.getPostByTitleOrId(id);
      if (!post) {
        res.status(404).json({ error: `post not found: ${id}` });
        return;
      }

      const image = queryImage(req);
      let result: RankResult;
      try {
        result = await deps.rankForPost(post, { image });
      } catch (error) {
        if (error instanceof RankError && error.code === "no_embedding") {
          res.status(409).json({ error: error.message });
          return;
        }
        if (error instanceof RankError && error.code === "image_not_found") {
          res.status(404).json({ error: error.message });
          return;
        }
        throw error;
      }

      if (persist) {
        await deps.replaceSuggestions(
          post.id,
          toSuggestionWrites(result, image === null),
        );
      }

      res.json(toRankJson(result));
    });

  app.get("/posts/:id/images", rankHandler(false));
  app.post("/posts/:id/images", rankHandler(true));

  app.get(
    "/suggestions/:id",
    asyncRoute(async (req, res) => {
      const id = req.params.id ?? "";
      const row = await deps.getSuggestionById(id);
      if (!row) {
        res.status(404).json({ error: `suggestion not found: ${id}` });
        return;
      }
      res.json(suggestionJson(row));
    }),
  );

  app.post(
    "/suggestions/:id/review",
    asyncRoute(async (req, res) => {
      const parsed = ReviewBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid review body" });
        return;
      }

      const id = req.params.id ?? "";
      const existing = await deps.getSuggestionById(id);
      if (!existing) {
        res.status(404).json({ error: `suggestion not found: ${id}` });
        return;
      }
      if (existing.decision !== "suggested") {
        res.status(400).json({
          error: `cannot review a ${existing.decision} row`,
        });
        return;
      }

      const updated = await deps.setSuggestionReview(id, parsed.data.review);
      if (!updated) {
        res.status(404).json({ error: `suggestion not found: ${id}` });
        return;
      }
      res.json(suggestionJson(updated));
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid JSON" });
      return;
    }
    next(err);
  });

  return app;
}
