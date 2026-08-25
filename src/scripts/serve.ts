import { port } from "../config.js";
import { createApp } from "../http/app.js";
import { realDeps } from "../http/deps.js";

const app = createApp(realDeps());

app.listen(port, "localhost", () => {
  console.log(`listening on http://localhost:${port}`);
});
