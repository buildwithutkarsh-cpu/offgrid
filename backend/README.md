# OffGrid Delhi API

This Express API is separate from the static website. Deploy this folder as a Render **Web Service**. The admin interface is static and lives in the website's `admin/` folder, so it is served at `https://your-site.example/admin/` by your static host.

## Local development

From this folder, run `npm install`, then `npm run dev`. The health endpoint is available at `http://localhost:3000/api/health`.

## Render setup

- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment Variable:** `FRONTEND_ORIGIN` = the exact origin of the deployed static website (for example, `https://your-site.example`, without a path)

Render supplies `PORT` automatically. After deploying, check `https://your-api.onrender.com/api/health`.

For local browser development, the default allowed origin is `http://localhost:5500`. Set `FRONTEND_ORIGIN` to a comma-separated list if the site uses multiple origins. Requests without an `Origin` header, such as health checks from command-line tools, are allowed.

## Admin dashboard

Visit `/admin/` on the static website. The first time, paste the Render backend origin into the connection field; it is saved in that browser's local storage. Configure these environment variables in Render (and in your shell for local development):

- `ADMIN_PASSWORD`: a strong, private admin password.
- `ADMIN_SESSION_SECRET`: a long random secret used to sign admin sessions. Keep it private and do not commit it.
- `FRONTEND_ORIGIN`: configure the website origin as above.

Admin sessions are signed, stored in an HttpOnly cookie, expire after eight hours, and login attempts are rate-limited. On HTTPS, the cookie uses `SameSite=None; Secure` for cross-origin requests from the static host. CORS allows credentialed requests only from `FRONTEND_ORIGIN`. The dashboard currently shows API status only; registration storage and management have not been implemented.