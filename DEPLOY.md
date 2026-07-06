# Share OneMoreThing via a link (GitHub Pages + AI for everyone)

Goal: a public link testers can open, where the **demo, tiles, summary and AI
all work** — without your OpenAI key being exposed or auto-revoked.

How it works: the site is hosted free on **GitHub Pages**; the AI key lives in
a tiny free **Cloudflare Worker** proxy, so the browser never sees it.

Do the parts in order. ~20 minutes the first time.

---

## Part 1 — Put your key in a proxy (Cloudflare Worker)

1. Go to <https://dash.cloudflare.com> and sign up / log in (free).
2. Left menu: **Workers & Pages** → **Create** → **Create Worker**.
3. Give it a name, e.g. `omt-proxy` → **Deploy**.
4. Click **Edit code**. Delete the sample, and paste the entire contents of
   `deploy/openai-proxy-worker.js` from this project. Click **Deploy**.
5. Go to the Worker's **Settings → Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Name: `OPENAI_API_KEY`
   - Value: your OpenAI key (`sk-...`)
   - **Save / Deploy**.
6. Copy the Worker URL shown at the top — it looks like
   `https://omt-proxy.YOURNAME.workers.dev`.

Test it works: it should respond to a POST. You can skip testing and just
continue — you'll see it work in the app at the end.

---

## Part 2 — Point the app at the proxy

1. Open `js/secrets.js`.
2. Set the proxy URL and make sure the key line is **blank**:

   ```js
   const OPENAI_API_KEY = "";                                  // MUST be blank for a public repo
   const AI_PROXY_URL   = "https://omt-proxy.YOURNAME.workers.dev";  // your Worker URL
   ```

   > Important: `OPENAI_API_KEY` must be `""` before you push to a **public**
   > GitHub repo. The proxy URL is safe to commit (it is not a secret).

3. Save.

---

## Part 3 — Put the code on GitHub

**Easiest (no command line) — GitHub Desktop:**

1. Install GitHub Desktop (<https://desktop.github.com>) and sign in.
2. **File → Add Local Repository** → choose this `onemorething` folder →
   when prompted, **create a repository** here.
3. Give it a name (e.g. `onemorething`), keep it **Public**, click
   **Create Repository**.
4. Click **Publish repository** (top bar). Untick "Keep this code private" if
   you want a public link. Publish.

**Or command line:**

```bash
cd ~/Documents/onemorething        # or wherever the folder is
git init
git add .
git commit -m "OneMoreThing prototype"
# create an empty repo named onemorething on github.com first, then:
git remote add origin https://github.com/YOURNAME/onemorething.git
git branch -M main
git push -u origin main
```

> Double-check `js/secrets.js` has a blank `OPENAI_API_KEY` before pushing.

---

## Part 4 — Turn on GitHub Pages

1. On github.com open your repo → **Settings** → **Pages** (left menu).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait ~1 minute. The page shows your link:
   `https://YOURNAME.github.io/onemorething/`

---

## Part 5 — Share and test

- Send the link. Testers open it in **Chrome**.
- **Play demo** shows the whole thing instantly.
- **Start** uses their microphone (Pages is HTTPS, so the mic is allowed).
- The **AI works for everyone** via your proxy — no key needed by them.
- At the end they get the transcript, AI speaker labels, and a copy-paste summary.

## Updating later

Change files → in GitHub Desktop, **Commit** then **Push** (or `git add . &&
git commit -m "update" && git push`). Pages redeploys automatically in ~1 min.

## Cost / safety notes

- Every tester's AI usage is billed to **your** OpenAI account. For a small
  pilot that's pennies, but set a **usage limit** in the OpenAI dashboard, and
  you can add rate-limiting to the Worker later if needed.
- If you ever need to cut off AI access, delete or disable the Cloudflare
  Worker — the site keeps working on the offline rules engine.
- This is a prototype for informal testing, not clinical use, and not for real
  patient data on a public link.
