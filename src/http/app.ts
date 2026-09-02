import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  RankError,
  toRankJson,
  toSuggestionWrites,
  type RankOpts,
  type RankResult,
} from "../rank-result.js";
import type { PostRow, Review, SuggestionRow, SuggestionWrite } from "../types.js";

export const ReviewBodySchema = z.object({ review: z.enum(["approved", "rejected"]) });

/** Everything the handlers need from the database and ranker, so tests can stub it. */
export type HttpDeps = {
  getPostByTitleOrId: (query: string) => Promise<PostRow | null>;
  rankForPost: (post: PostRow, opts?: RankOpts) => Promise<RankResult>;
  replaceSuggestions: (postId: string, rows: SuggestionWrite[]) => Promise<void>;
  getSuggestionById: (id: string) => Promise<SuggestionRow | null>;
  setSuggestionReview: (id: string, review: Review) => Promise<SuggestionRow>;
};

type Handler = (req: Request, res: Response) => Promise<void>;

const asyncRoute = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
  handler(req, res).catch(next);
};

function queryImage(req: Request): string | null {
  const value = req.query.image;
  return typeof value === "string" && value !== "" ? value : null;
}

const rankStatus: Record<RankError["code"], number> = {
  no_embedding: 409,
  image_not_found: 404,
};

export function createApp(deps: HttpDeps) {
  const app = express();
  app.use(express.json());

  const rankHandler = (persist: boolean) =>
    asyncRoute(async (req, res) => {
      const id = String(req.params.id);
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
        if (error instanceof RankError) {
          res.status(rankStatus[error.code]).json({ error: error.message });
          return;
        }
        throw error;
      }

      if (persist) {
        await deps.replaceSuggestions(post.id, toSuggestionWrites(result, image === null));
      }
      res.json(toRankJson(result));
    });

  app.get("/posts/:id/images", rankHandler(false));
  app.post("/posts/:id/images", rankHandler(true));

  app.get(
    "/suggestions/:id",
    asyncRoute(async (req, res) => {
      const id = String(req.params.id);
      const row = await deps.getSuggestionById(id);
      if (!row) {
        res.status(404).json({ error: `suggestion not found: ${id}` });
        return;
      }
      res.json(row);
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

      const id = String(req.params.id);
      const existing = await deps.getSuggestionById(id);
      if (!existing) {
        res.status(404).json({ error: `suggestion not found: ${id}` });
        return;
      }
      if (existing.decision !== "suggested") {
        res.status(400).json({ error: `cannot review a ${existing.decision} row` });
        return;
      }

      res.json(await deps.setSuggestionReview(id, parsed.data.review));
    }),
  );

  // Express identifies an error handler by its four parameters.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
