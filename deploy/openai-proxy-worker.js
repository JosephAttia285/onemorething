/**
 * OneMoreThing — OpenAI proxy (Cloudflare Worker)
 * ===============================================
 * Holds your OpenAI key server-side so the public web app can use the AI
 * without the key ever appearing in the browser / GitHub.
 *
 * Deploy (dashboard, no CLI needed):
 *   1. dash.cloudflare.com → Workers & Pages → Create → Create Worker.
 *   2. Name it e.g. "omt-proxy", Deploy, then "Edit code".
 *   3. Replace the sample code with THIS file's contents, Deploy.
 *   4. Settings → Variables and Secrets → add a SECRET named OPENAI_API_KEY
 *      with your key value. Deploy again.
 *   5. Copy the Worker URL (e.g. https://omt-proxy.<you>.workers.dev) and put
 *      it in js/secrets.js as AI_PROXY_URL.
 *
 * The web app posts to <worker>/chat/completions; the path is ignored and the
 * request is forwarded to OpenAI's chat completions endpoint with your key.
 */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") {
      return new Response("Use POST", { status: 405, headers: cors });
    }
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY secret not set on the Worker" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const body = await request.text();
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.OPENAI_API_KEY,
      },
      body,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
