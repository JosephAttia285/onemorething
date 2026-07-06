/* ============================================================
   secrets.js — private local configuration
   ------------------------------------------------------------
   Paste your OpenAI API key between the quotes below and save.
   The app will then connect to the AI automatically on load —
   no need to open AI settings each time.

   ⚠ Keep this file private:
     • Do not share the folder with the key still in it.
     • Do not commit it to git / push it anywhere public.
     • Anyone who opens this file can read the key.
   Leave it as "" to run purely on the offline rules engine.
   ============================================================ */

// Cloudflare Worker URL — enables AI for EVERYONE on a shared link without
// exposing the key. When set, this is used instead of the key below.
// Safe to commit (it is not a secret). See DEPLOY.md.

const OPENAI_API_KEY = "";                                       // blank for the public repo
const AI_PROXY_URL   = "https://omt-proxy.josephattia285.workers.dev";      // your Worker URL