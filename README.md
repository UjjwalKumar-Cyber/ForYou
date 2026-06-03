# ForyoU

ForyoU is a private, nostalgic messaging website built with Node.js, Express, Socket.IO, and SQLite-style JSON storage locally or Postgres on Render. The main public entry is the account login at `/admin`, with logged-in account chats, realtime delivery, media sharing, profiles, voice notes, starred messages, and a warm handwritten-letter style UI.

Locally, data is saved in `data/messages.json`. On Render, the included Blueprint uses Render Postgres through `DATABASE_URL`.

## Folder Structure

```text
foryou/
├── data/
│   ├── .gitkeep
│   └── messages.json
├── public/
│   ├── assets/
│   │   └── seal.svg
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── admin.js
│   │   ├── message.js
│   │   ├── profile.js
│   │   └── secret-login.js
│   ├── manifest.webmanifest
│   └── sw.js
├── scripts/
│   └── hash-password.js
├── src/
│   ├── security/
│   │   └── passwords.js
│   └── storage/
│       └── messages.js
├── views/
│   ├── admin.html
│   ├── message.html
│   ├── password.html
│   └── profile.html
├── .env.example
├── .gitignore
├── package.json
├── README.md
├── render.yaml
└── server.js
```

## Features

- Main login route: `/admin`
- Legacy secret route `/secret-8392-love-note` is hidden by default and redirects to `/admin`
- Logged-in sender, recipient picker, 500 character limit, and media upload up to 8 MB
- Account login at `/admin`
- Built-in first-run accounts: `Kabir` / `Kabir@` and `Kaish` / `Kaish@`
- Realtime chat delivery with Socket.IO
- Typing indicator, read receipts, replies, emoji reactions, and search
- Voice notes, images, videos, PDFs, and text file sharing
- Message highlights for new incoming messages
- Simple inbox-first chat layout with full history after tapping a sender
- Sender profile view with photo, username, and bio
- Privacy-first chat access: regular users do not see online status, active friends, or last seen
- Exact username search for starting new chats, with admin-controlled hidden users
- Starred messages that stay saved
- Delete option inside each message history
- Normal messages auto-expire after 24 hours unless starred
- Profile settings for display name, username, password, profile photo, bio, email, theme, wallpaper, font, and color
- Mobile-first nostalgic letter UI with dark, light, and midnight themes
- PWA manifest and service worker for app-like loading of static assets
- Long-lived sessions with manual logout
- Transparent ultimate-admin monitoring for online status, last seen, login history, suspicious login attempts, device/browser summaries, and approximate IP-based city/country
- Admin account block/suspend controls, search visibility controls, popup alerts, storage dashboard, backups, and one-click log cleanup
- Optional Cloudinary media storage so profile pictures, chat images, voice notes, videos, and attachments are stored as URLs with public IDs instead of large database blobs
- PostgreSQL-backed sessions in production when `DATABASE_URL` is configured
- `helmet` security headers and `express-rate-limit`
- Server-side sanitization with `sanitize-html`
- Client-side rendering avoids injecting user text as HTML
- `noindex, nofollow` meta tags and `robots.txt` crawler deny rule
- Gzip compression, PostgreSQL pooling, targeted indexes, pagination limits, optimized image compression, lazy media loading, and periodic cleanup

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```bash
SERVICE_DISCONTINUED=false
ENABLE_DISCONTINUED_MODE=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
SESSION_SECRET=generate-a-long-random-string
ENABLE_SECRET_PAGE=false
```

## Service Mode

The project is currently set to live mode with:

```bash
SERVICE_DISCONTINUED=false
ENABLE_DISCONTINUED_MODE=false
```

In live mode, `/admin`, `/profile`, chats, admin tools, and `/watch-together`
are available. To temporarily show only the discontinued notice later, set
both `SERVICE_DISCONTINUED=true` and `ENABLE_DISCONTINUED_MODE=true`, then redeploy.

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Optional extra accounts can be seeded with:

```bash
ACCOUNT_USERS=ujjwal:password123,aavnya:anotherpassword
```

Optional Cloudinary media storage:

```bash
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
```

Optional local backup folder:

```bash
BACKUP_DIR=/Users/ujjwalkumar/Downloads/FORYOU_BACKUP
```

The app stores password hashes, not readable passwords. To manually create a hashed password:

```bash
npm run hash-password -- your-password
```

Maintenance helpers for the 1GB storage limit:

```bash
npm run maintenance:summary
npm run maintenance:cleanup
```

Cleanup removes logs and expired/seen popup history only. It does not delete users, messages, media, reactions, starred messages, memories, or chat history.

## Run Locally

```bash
npm run dev
```

Open:

- Main login/inbox: `http://localhost:3000/admin`
- Old secret URL redirects to login: `http://localhost:3000/secret-8392-love-note`
- Profile settings: `http://localhost:3000/profile`

If no `.env` is present, development fallback passwords are:

- Admin account: `admin` / `admin-love-notes`

## Main Routes

```text
GET    /secret-8392-love-note  -> redirects to /admin unless ENABLE_SECRET_PAGE=true
GET    /admin
GET    /profile
POST   /api/login
POST   /api/logout
POST   /api/message
GET    /api/session
GET    /api/recipients
GET    /api/users/search?username=USERNAME
GET    /api/chats
GET    /api/chats/:peer/messages
POST   /api/chats/:peer/read
GET    /api/messages
GET    /api/messages/starred
POST   /api/messages/:id/star
POST   /api/messages/:id/reactions
DELETE /api/messages/:id
POST   /api/ping
GET    /api/admin/monitoring
GET    /api/admin/storage-summary
GET    /api/admin/backups
POST   /api/admin/backup
POST   /api/admin/cleanup-logs
POST   /api/admin/cleanup-storage
GET    /api/admin/users/:username/logins
PATCH  /api/admin/users/:username/security
PATCH  /api/admin/users/:username/search-visibility
GET    /api/profile
PATCH  /api/profile
POST   /api/profile/avatar
PATCH  /api/account/profile
PATCH  /api/account/password
PATCH  /api/settings/anonymous-mode
GET    /api/active-friends
```

`GET /api/users/search?username=USERNAME` only accepts exact, case-insensitive usernames. Normal users cannot search hidden users, admin users, restricted search terms, blocked users, or themselves. `ultimate_admin` can search and manage all users.

`POST /api/message` accepts `multipart/form-data`:

```text
senderName=Sender name
recipientUsername=kabir
message=Your note
attachment=@photo.png
replyToId=optional-message-id
```

Logged-in users can send account-to-account messages from the chat composer. Public secret-page sending is disabled unless you intentionally set `ENABLE_SECRET_PAGE=true` and configure `MESSAGE_PAGE_PASSWORD`.

## Backups

Ultimate admins can use **Storage & Backup** in the admin drawer.

Local development backups are written to:

```text
/Users/ujjwalkumar/Downloads/FORYOU_BACKUP/foryou-backup-YYYY-MM-DD-HHMM/
```

Each backup contains:

- `manifest.json`
- `inbox_users.json`
- `messages.json`
- `notification_alerts.json`
- `login_history.json`
- `user_activity_sessions.json`
- `admin_action_logs.json`
- `important_audit_logs.json`
- `restricted_search_terms.json`
- `backup_history.json`
- `media_manifest.json`

A combined `foryou-backup-YYYY-MM-DD-HHMM.json` bundle is also created. In production on Render, local files are temporary; if Cloudinary is configured, the bundle is uploaded as Cloudinary raw storage and the URL is saved in backup history.

Restore is intentionally manual for now. To restore, stop the app, inspect the backup JSON files, import rows into PostgreSQL in dependency order (`inbox_users`, then `messages`, then notification/log tables), and keep environment secrets from Render or `.env`; backups do not include `DATABASE_URL`, `SESSION_SECRET`, or Cloudinary secrets.

## Render Deployment

### Option 1: Render Blueprint

1. Push this project to GitHub.
2. In Render, choose **New +** then **Blueprint**.
3. Connect the GitHub repository.
4. Render reads `render.yaml` and creates:
   - Web service: `foryou`
   - Postgres database: `foryou-db`
5. When Render asks for secret values, set:
   - `ADMIN_PASSWORD`
   - optional `ACCOUNT_USERS`
6. Deploy.

Your live URL may look like `https://foryou-zbm5.onrender.com`; the service name inside Render can still be `foryou`.

### Option 2: Manual Web Service

1. Create a Render **Web Service** from the GitHub repo.
2. Use:
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Add environment variables:
   - `NODE_ENV=production`
   - `ENABLE_SECRET_PAGE=false`
   - `ADMIN_USERNAME=admin`
   - `ADMIN_PASSWORD=your-admin-password`
   - `SESSION_SECRET=a-long-random-string`
   - optional `ACCOUNT_USERS=username:password,another:password`
4. Create a Render Postgres database.
5. Add its internal connection string as `DATABASE_URL`.
6. Deploy.

After deployment:

- Main login/inbox: `https://your-render-url/admin`
- Old secret URL redirects to login: `https://your-render-url/secret-8392-love-note`
- Profile settings: `https://your-render-url/profile`

## Privacy Notes

The app saves message text, sender display name, recipient username, timestamps, media URLs or media data, profile settings, and password hashes. The secret-note page is hidden by default, so normal message sending happens after account login.

For signed-in accounts, the ultimate admin dashboard transparently stores security analytics: online status, last seen, login/logout/session times, login attempts, device/browser details, screen size, language, timezone, IP address, and approximate IP-based city/country/ISP when available. It does not collect exact GPS, contacts, SMS, calls, IMEI, or private device identifiers. Anonymous Mode still hides online, typing, and read receipts from regular users; only the ultimate admin monitoring dashboard can see true online status for security.
