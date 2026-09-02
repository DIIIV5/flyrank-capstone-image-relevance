import { port } from "../config.js";
import {
  getPostByTitleOrId,
  getSuggestionById,
  replaceSuggestions,
  setSuggestionReview,
} from "../db.js";
import { createApp } from "../http/app.js";
import { rankForPost } from "../rank.js";

const app = createApp({
  getPostByTitleOrId,
  rankForPost,
  replaceSuggestions,
  getSuggestionById,
  setSuggestionReview,
});

app.listen(port, "localhost", () => {
  console.log(`listening on http://localhost:${port}`);
});
