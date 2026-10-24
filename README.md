# Go Next Hobbies Field Sales

Mobile-first private field-sales app for salesperson-held inventory and in-person sales.

## Features

- Password gate using `APP_PASSWORD` from environment variables.
- Session-only HTTP-only cookie; no password is stored in the browser.
- Reads Shopify catalog data through the existing `pnlstore` `/api/inventory` endpoint.
- Never writes product, price, order, or inventory changes back to Shopify.
- Stores salesperson holdings, sales, commission/cut, inventory history, voids and settlements in MongoDB.
- Real-time UI refreshes through Server-Sent Events.
- Mobile-first React interface with animated sheets and transitions.

## Environment variables

Copy `.env.example` to `.env` locally. `.env` and `.env.*` are gitignored, except `.env.example`.

```bash
APP_PASSWORD=your-private-password
APP_SECRET=a-long-random-secret
MONGODB_URI=your-mongodb-connection-string
PNLSTORE_API_URL=https://your-pnlstore-deployment.example.com
SALESPERSON_NAME=Karl
```

Use a long random `APP_SECRET` that is different from the access password.

## Local development

```bash
npm install
npm run server
```

In another terminal:

```bash
npm run dev
```

Vite proxies `/api` calls to the Express server on port 3000.

## Railway / production

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm start
```

Set `NODE_ENV=production` plus all variables above in Railway. Express serves the built Vite `dist` directory in production.

## Inventory behavior

The Shopify/pnlstore quantity is informational only. Giving stock to the salesperson creates or increments a MongoDB `Holding`. A sale decrements that holding. Voiding a sale restores it. Adjustments and returns are recorded in the inventory transaction ledger.
