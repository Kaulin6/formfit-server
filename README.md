# FormFit Custom — Order Pipeline Server

Backend server for the FormFit Custom 3D-printed shadow box business. Handles Facebook Messenger webhook, order processing, pricing, and a dashboard for Ethan to manage orders.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and fill in your Facebook tokens
```

## Run

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

## Expose webhook with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL ngrok gives you (e.g. `https://abc123.ngrok.io`).

## Facebook Webhook Setup

1. Go to [Facebook Developers](https://developers.facebook.com) → your app
2. Under **Messenger → Settings → Webhooks**, click **Add Callback URL**
3. Enter: `https://your-ngrok-url.ngrok.io/webhook`
4. Verify token: use the `VERIFY_TOKEN` value from your `.env`
5. Subscribe to: `messages`, `messaging_postbacks`
6. Under **Access Tokens**, generate a Page Access Token and put it in `.env` as `PAGE_ACCESS_TOKEN`

## Dashboard

Open in your browser:

```
http://localhost:3000/dashboard
```

Features:
- Order queue with status tracking
- Click any order to expand details, photo, and conversation history
- Status buttons: Mark as Printed, Mark as Shipped, Cancel
- ToolTrace integration (SELF orders) and Craftcloud placeholder (CLOUD orders)
- Summary stats: total orders, pending, revenue, margin

## Architecture

```
src/
  index.js         — Express server entry point
  db.js            — SQLite database (orders, messages, conversation state)
  webhook.js       — Facebook Messenger webhook routes
  conversation.js  — Auto-reply state machine
  messenger.js     — Facebook Graph API messaging helpers
  pricing.js       — Pricing engine (SELF + CLOUD modes)
public/
  dashboard.html   — Ethan's order management dashboard
uploads/           — Downloaded customer photos
```

## Order Flow

1. Customer sends message on Facebook → webhook receives it
2. Bot welcomes them, asks for a photo
3. Customer sends tool photo → bot asks for material/color/size
4. Customer replies with details → bot asks SELF or CLOUD
5. Bot generates quote and sends proposal
6. Customer confirms → order created with ID FFC-XXXXX
7. Ethan manages order from the dashboard
