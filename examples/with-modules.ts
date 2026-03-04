import { loadModules, serve } from "../src/mcp";
import recall from "../src/modules/recall";
import patterns from "../src/modules/patterns";
import beacon from "../src/modules/beacon";

await loadModules([
  recall({ dbPath: ":memory:" }),
  patterns(),
  beacon({ maxResults: 20 }),
]);

serve({ name: "modules-server", version: "1.0.0" });
