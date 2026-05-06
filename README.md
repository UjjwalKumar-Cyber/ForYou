# ForyoU

ForyoU is a complete Node.js and Express private anonymous messaging site. The secret page is password-protected, accepts anonymous notes up to 500 characters, stores them with timestamps in a local JSON file, and exposes an admin-only dashboard for reading and deleting messages.

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
- Anonymous message form with a 500 character limit
- Timestamped message storage in `data/messages.json`
- Admin-only message dashboard at `/admin`
- Admin delete button for each message
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
ADMIN_PASSWORD=your-admin-password
SESSION_SECRET=generate-a-long-random-string
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
- Admin page: `http://localhost:3000/admin`

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
GET    /api/messages
DELETE /api/messages/:id
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
  "scope": "admin",
  "password": "admin-password"
}
```

`POST /api/message` accepts:

```json
{
  "message": "Your anonymous note"
}
```

## Render Deployment

### Option 1: Render Blueprint

This repo includes `render.yaml`, so Render can create the service with the correct build command, start command, persistent disk, and production environment settings.

1. Push this project to a GitHub repository named `ForyoU` or `foryou`.
2. In Render, choose **New +** and then **Blueprint**.
3. Connect your GitHub repository.
4. Render will read `render.yaml`.
5. When Render asks for secret values, add:
   - `MESSAGE_PAGE_PASSWORD`
   - `ADMIN_PASSWORD`
6. Deploy.

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
   - `SESSION_SECRET=a-long-random-string`
   - `DATA_DIR=/var/data`
5. Add a Render persistent disk:
   - Mount path: `/var/data`
   - Size: any small size is fine for text messages
6. Deploy.

After deployment:

- Secret page: `https://foryou.onrender.com/secret-8392-love-note` or your Render-generated URL
- Admin page: `https://foryou.onrender.com/admin` or your Render-generated URL

## Notes

Messages are stored as:

```json
{
  "id": "random-uuid",
  "text": "sanitized message text",
  "createdAt": "2026-05-06T00:00:00.000Z"
}
```

The app does not persist sender names, emails, IP addresses, or login attempts. Rate limiting uses the current browser session as its key and keeps counters only in memory.
