// Vercel BotID (Basic, free): the browser collects the signals the server checks on the free-text path.
// Skipped on localhost, where Vercel's challenge script is not served; the server check is skipped there too.
import { initBotId } from "botid/client/core";

if (typeof location === "undefined" || location.hostname !== "localhost") {
  initBotId({ protect: [{ path: "/api/ask", method: "POST" }] });
}
