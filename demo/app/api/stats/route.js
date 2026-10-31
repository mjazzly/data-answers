// Today's question count, this month's cost and why questions were turned away. Public: these are the
// numbers the page footer shows. Cached at the edge for 30 seconds so reading it costs Redis little.
// ?day=YYYY-MM-DD reads an earlier day (the nightly record uses it). The site reads it too.
import { stats, dayKey } from "../../../lib/limits.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = "https://mjazzly.github.io";

export async function GET(req) {
  const q = new URL(req.url).searchParams.get("day");
  const day = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : dayKey();
  try {
    return Response.json(await stats(day), { headers: { "Cache-Control": "public, s-maxage=30, max-age=0", "Access-Control-Allow-Origin": ORIGIN } });
  } catch {
    return Response.json({ error: "stats unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": ORIGIN } });
  }
}
