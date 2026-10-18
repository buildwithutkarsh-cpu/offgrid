# OffGrid Delhi API

This Express API is separate from the static website. Deploy this folder as a Render **Web Service**. The admin interface is static and lives in the website's `admin/` folder, so it is served at `https://your-site.example/admin/` by your static host.

## Local development

From this folder, set `MONGODB_URI`, then run `npm install` and `npm run dev`. For local secrets, create `backend/.env.local` (ignored by Git) with `MONGODB_URI`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `FRONTEND_ORIGIN`. The health endpoint is available at `http://localhost:3000/api/health`.

## Render setup

- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment Variable:** `FRONTEND_ORIGIN` = the exact origin of the deployed static website (for example, `https://your-site.example`, without a path)
- **Environment Variable:** `MONGODB_URI` = the MongoDB Atlas connection string for the database

Render supplies `PORT` automatically. Create an Atlas database, allow Render to connect in Atlas Network Access, and add the Atlas connection string as `MONGODB_URI` in Render. Keep the URI secret. After deploying, check `https://your-api.onrender.com/api/health`; the response should show `"database":"connected"`.

For local browser development, the default allowed origin is `http://localhost:5500`. Set `FRONTEND_ORIGIN` to a comma-separated list if the site uses multiple origins. Requests without an `Origin` header, such as health checks from command-line tools, are allowed.

## Online puzzles

The private source file belongs at `../tmp/puzzle.csv` and is ignored by Git. Run `npm run check:puzzles` from `backend/` to validate its 7-column CSV structure, rows, unique day/ticket codes, and question/hint coverage for every puzzle type without touching the database. Set `MONGODB_URI` in `backend/.env.local`, then run `npm run import:puzzles` to upsert the puzzle set into MongoDB. Re-run the import after changing the source CSV. The `Key` puzzle type has no key column in the CSV; its in-game hint calls this out, and that cipher needs its key/rule supplied to be fully fair-play solvable.

The static game is served at `/play/`. It requests a ticket's current-day puzzle from `GET /api/puzzles/today?ticketCode=...`; answers are checked by `POST /api/puzzles/answer` and are never sent to the browser. The API uses the Asia/Kolkata date and only serves the seven-day round from 1 through 7 November 2026. Puzzle progress is saved per day and ticket code.

## Admin dashboard

Visit `/admin/` on the static website. The dashboard connects to the configured Render API URL. Configure these environment variables in Render (and in your shell for local development):

- `ADMIN_PASSWORD`: a strong, private admin password.
- `ADMIN_SESSION_SECRET`: a long random secret used to sign admin sessions. Keep it private and do not commit it.
- `FRONTEND_ORIGIN`: configure the website origin as above.

Admin sessions are signed, stored in an HttpOnly cookie, expire after eight hours, and login attempts are rate-limited. On HTTPS, the cookie uses `SameSite=None; Secure` for cross-origin requests from the static host. CORS allows credentialed requests only from `FRONTEND_ORIGIN`.

## Participation registration

The static registration page remains closed until **1 November 2026 at 12:00 AM IST** and displays a countdown. Visit `/register/?preview` on the static site to preview the form; preview submissions are disabled. The API also rejects submissions before the opening time. Once open, the form submits to `POST /api/registrations`. It stores the participant's name and age, guardian's name, email and phone, required guardian consent, a registration code, and creation time. The public endpoint is rate-limited; registration details are only available through the admin-protected `GET /api/admin/registrations` endpoint. Data is retained until deleted from the MongoDB collection, so limit database access and establish an appropriate retention/deletion policy before opening registration.