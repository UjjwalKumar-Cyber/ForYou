# ForyoU

ForyoU is a private, nostalgic messaging website built with Node.js, Express, Socket.IO, and SQLite-style JSON storage locally or Postgres on Render. It has a password-protected secret note page plus logged-in account chats with realtime delivery, media sharing, profiles, voice notes, starred messages, and a warm handwritten-letter style UI.

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

- Secret private route: `/secret-8392-love-note`
- Password screen before the public note form
- Sender name, recipient picker, 500 character limit, and media upload up to 8 MB
- Account login at `/admin`
- Built-in first-run accounts: `Kabir` / `Kabir@` and `Kaish` / `Kaish@`
- Realtime chat delivery with Socket.IO
- Typing indicator, read receipts, replies, emoji reactions, and search
- Voice notes, images, videos, PDFs, and text file sharing
- Message highlights for new incoming messages
- Active friends strip with online indicators
- Simple inbox-first chat layout with full history after tapping a sender
- Sender profile view with photo, username, active status, and bio
- Anonymous Mode to hide active status, typing, and read receipts
- Starred messages that stay saved
- Delete option inside each message history
- Normal messages auto-expire after 24 hours unless starred
- Profile settings for display name, username, password, profile photo, bio, email, theme, wallpaper, font, and color
- Mobile-first nostalgic letter UI with dark, light, and midnight themes
- PWA manifest and service worker for app-like loading of static assets
- Long-lived sessions with manual logout
- `helmet` security headers and `express-rate-limit`
- Server-side sanitization with `sanitize-html`
- Client-side rendering avoids injecting user text as HTML
- `noindex, nofollow` meta tags and `robots.txt` crawler deny rule

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```bash
MESSAGE_PAGE_PASSWORD=your-secret-page-password
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
SESSION_SECRET=generate-a-long-random-string
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Optional extra accounts can be seeded with:

```bash
ACCOUNT_USERS=ujjwal:password123,aavnya:anotherpassword
```

The app stores password hashes, not readable passwords. To manually create a hashed password:

```bash
npm run hash-password -- your-password
```

## Run Locally

```bash
npm run dev
```

Open:

- Secret page: `http://localhost:3000/secret-8392-love-note`
- Account inbox: `http://localhost:3000/admin`
- Profile settings: `http://localhost:3000/profile`

If no `.env` is present, development fallback passwords are:

- Secret page: `open-the-secret-note`
- Admin account: `admin` / `admin-love-notes`

## Main Routes

```text
GET    /secret-8392-love-note
GET    /admin
GET    /profile
POST   /api/login
POST   /api/logout
POST   /api/message
GET    /api/session
GET    /api/recipients
GET    /api/chats
GET    /api/chats/:peer/messages
POST   /api/chats/:peer/read
GET    /api/messages
GET    /api/messages/starred
POST   /api/messages/:id/star
POST   /api/messages/:id/reactions
DELETE /api/messages/:id
GET    /api/profile
PATCH  /api/profile
POST   /api/profile/avatar
PATCH  /api/account/profile
PATCH  /api/account/password
PATCH  /api/settings/anonymous-mode
GET    /api/active-friends
```

`POST /api/message` accepts `multipart/form-data`:

```text
senderName=Sender name
recipientUsername=kabir
message=Your note
attachment=@photo.png
replyToId=optional-message-id
```

Logged-in users can send account-to-account messages from the chat composer; public visitors can send through the secret note page after entering the secret password.

## Render Deployment

### Option 1: Render Blueprint

1. Push this project to GitHub.
2. In Render, choose **New +** then **Blueprint**.
3. Connect the GitHub repository.
4. Render reads `render.yaml` and creates:
   - Web service: `foryou`
   - Postgres database: `foryou-db`
5. When Render asks for secret values, set:
   - `MESSAGE_PAGE_PASSWORD`
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
   - `MESSAGE_PAGE_PASSWORD=your-secret-page-password`
   - `ADMIN_USERNAME=admin`
   - `ADMIN_PASSWORD=your-admin-password`
   - `SESSION_SECRET=a-long-random-string`
   - optional `ACCOUNT_USERS=username:password,another:password`
4. Create a Render Postgres database.
5. Add its internal connection string as `DATABASE_URL`.
6. Deploy.

After deployment:

- Secret page: `https://your-render-url/secret-8392-love-note`
- Account inbox: `https://your-render-url/admin`
- Profile settings: `https://your-render-url/profile`

## Privacy Notes

The app saves message text, sender display name, recipient username, timestamps, media data, profile settings, and password hashes. It does not save sender email, sender IP address, or public visitor login details with messages. Rate limiting uses the current browser session as its key and stores counters only in memory.
