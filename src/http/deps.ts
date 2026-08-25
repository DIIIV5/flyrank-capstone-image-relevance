import {
  getPostByTitleOrId,
  getSuggestionById,
  replaceSuggestions,
  setSuggestionReview,
} from "../db.js";
import { rankForPost } from "../rank.js";
import type { HttpDeps } from "./app.js";

export function realDeps(): HttpDeps {
  return {
    getPostByTitleOrId,
    rankForPost,
    replaceSuggestions,
    getSuggestionById,
    setSuggestionReview,
  };
}
