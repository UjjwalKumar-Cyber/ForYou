# ForyoU

ForyoU is a complete Node.js and Express private messaging site. The secret page is password-protected, accepts messages up to 500 characters with a sender name, stores them with timestamps, and lets each inbox account log in with its own username and password to read only the messages sent to that account.

Locally, messages are saved in `data/messages.json`. On Render, the included Blueprint uses Render Postgres through `DATABASE_URL` so the app can run on Render's free web service plan.

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
│   └── js/
│       ├── admin.js
│       ├── message.js
│       └── secret-login.js
├── src/
│   └── storage/
│       └── messages.js
├── views/
│   ├── admin.html
│   ├── message.html
│   └── password.html
├── .env.example
├── .gitignore
├── package.json
├── README.md
├── render.yaml
└── server.js
```

## Features

- Secret private route: `/secret-8392-love-note`
- Password screen before the message page
- Message form with sender name, recipient inbox, and a 500 character limit
- Timestamped message storage in `data/messages.json`
- Render deployment stores messages in Postgres when `DATABASE_URL` is present
- Account inbox dashboard at `/admin`
- Username/password inbox login
- Logged-in accounts can send messages to other inbox accounts
- Auto-refreshing messages
- Logout button
- Long-lived signed-in sessions
- Delete button for each message
- `helmet` security headers
- `express-rate-limit` on login and message submission
- Server-side sanitization with `sanitize-html`
- Client-side rendering with `textContent` to avoid XSS
- No sender name, email, login details, or IP address saved with messages
- `noindex, nofollow` meta tags and `robots.txt` crawler block
- Mobile-first dark romantic UI

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and replace the default values:

```bash
MESSAGE_PAGE_PASSWORD=your-secret-page-password
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
SESSION_SECRET=generate-a-long-random-string
```

The default inbox account is seeded from `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

To add more inbox accounts without manually editing the database, set:

```bash
ACCOUNT_USERS=ujjwal:password123,aavnya:anotherpassword
```

To manually add an account in Postgres, first generate a password hash:

```bash
npm run hash-password -- your-password
```

Then insert it into the `inbox_users` table:

```sql
INSERT INTO inbox_users (username, display_name, password_hash)
VALUES ('ujjwal', 'Ujjwal', 'PASTE_HASH_HERE');
```

You can generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Run Locally

```bash
npm run dev
```

Open:

- Secret page: `http://localhost:3000/secret-8392-love-note`
- Inbox login page: `http://localhost:3000/admin`

For a production-like local run:

```bash
npm start
```

## API Routes

```text
GET    /secret-8392-love-note
POST   /api/login
POST   /api/message
GET    /admin
GET    /api/session
GET    /api/recipients
GET    /api/messages
DELETE /api/messages/:id
POST   /api/logout
```

`POST /api/login` accepts:

```json
{
  "scope": "secret",
  "password": "message-page-password"
}
```

or:

```json
{
  "scope": "account",
  "username": "admin",
  "password": "admin-password"
}
```

`POST /api/message` accepts:

```json
{
  "senderName": "Sender name",
  "recipientUsername": "admin",
  "message": "Your anonymous note"
}
```

## Render Deployment

### Option 1: Render Blueprint

This repo includes `render.yaml`, so Render can create the web service, a Postgres database, and the required production environment settings.

1. Push this project to a GitHub repository named `ForyoU` or `foryou`.
2. In Render, choose **New +** and then **Blueprint**.
3. Connect your GitHub repository.
4. Render will read `render.yaml`.
5. When Render asks for secret values, add:
   - `MESSAGE_PAGE_PASSWORD`
   - `ADMIN_PASSWORD`
   - optional `ACCOUNT_USERS`
6. Deploy.

The Blueprint uses:

- Web service plan: `free`
- Database plan: `free`
- Database access: internal/private only

Render's free Postgres databases expire 30 days after creation. Upgrade the database before then if you want to keep messages long-term.

### Option 2: Manual Web Service

1. Push this project to a GitHub repository named `ForyoU` or `foryou`.
2. In Render, create a new **Web Service** from that repository.
3. Use these settings:
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables:
   - `NODE_ENV=production`
   - `MESSAGE_PAGE_PASSWORD=your-secret-page-password`
   - `ADMIN_PASSWORD=your-admin-password`
   - `ADMIN_USERNAME=admin`
   - optional `ACCOUNT_USERS=username:password,another:password`
   - `SESSION_SECRET=a-long-random-string`
   - `DATA_DIR=/var/data`
5. Create a Render Postgres database and add its internal connection string as:
   - `DATABASE_URL=your-render-postgres-connection-string`
6. Deploy.

After deployment:

- Secret page: `https://foryou.onrender.com/secret-8392-love-note` or your Render-generated URL
- Admin page: `https://foryou.onrender.com/admin` or your Render-generated URL

## Notes

Local JSON messages are stored as:

```json
{
  "id": "random-uuid",
  "text": "sanitized message text",
  "senderName": "Sender name",
  "recipientUsername": "admin",
  "createdAt": "2026-05-06T00:00:00.000Z"
}
```

The app does not persist sender names, emails, IP addresses, or login attempts. Rate limiting uses the current browser session as its key and keeps counters only in memory.
