# PayDrop Backend API

NestJS backend for PayDrop peer-to-peer payment platform with OTP-based authentication, BLE discovery, transaction processing, and fraud pre-scoring.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (Neon recommended)
- Redis instance (Upstash recommended)
- Squad API credentials
- Firebase credentials
- Termii SMS API key

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set up Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection URL
- `SQUAD_SECRET_KEY`, `SQUAD_PUBLIC_KEY` - Squad API credentials
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` - JWT signing keys (random 64-char strings)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` - Firebase config
- `TERMII_API_KEY`, `TERMII_SENDER_ID` - Termii SMS config
- `FRAUD_SERVICE_URL` - Internal fraud engine URL
- `PORT` - Server port (default: 3000)

### 3. Initialize Database

```bash
npm run prisma:migrate
```

### 4. Start Development Server

```bash
npm run start:dev
```

Server will run on `http://localhost:3000`

**📚 Interactive Swagger API Docs:** http://localhost:3000/docs

## Project Structure

```
src/
├── auth/              # OTP & JWT authentication
├── users/             # User profiles & wallets
├── discover/          # BLE & QR token management
├── transactions/      # Payment flows & idempotency
├── notifications/     # FCM & WebSocket
├── webhooks/          # Squad inbound webhooks
└── common/            # Guards, pipes, interceptors
prisma/
└── schema.prisma      # Database schema
```

## Available Scripts

- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run start:dev` - Start development server with hot reload
- `npm run start:debug` - Start with debugging enabled
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio GUI

## API Documentation

### Interactive Swagger UI

Access **http://localhost:3000/docs** when the server is running for interactive API exploration with request/response examples.

### Base URL

All endpoints are prefixed with `/api/v1`

```
http://localhost:3000/api/v1/...
```

### Authentication

Bearer token required for all endpoints **except** `/auth/*`.

Include JWT in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Response Envelope

All API responses follow this standard format:

```json
{
  "success": boolean,
  "message": string,
  "data": object | null,
  "error": string (optional)
}
```

### Error Codes

- `400` - Bad Request (validation failure)
- `401` - Unauthorized (missing or expired token)
- `403` - Forbidden (insufficient permissions)
- `409` - Conflict (duplicate idempotency key)
- `422` - Unprocessable Entity (fraud engine blocked)
- `500` - Internal Server Error

## Endpoint Summary

### Auth (`/auth`)

- `POST /request-otp` - Send OTP to phone via SMS
- `POST /verify-otp` - Verify OTP and get access/refresh tokens
- `POST /refresh` - Exchange refresh token for new access token
- `POST /logout` - Invalidate refresh token

### Users (`/users`)

- `GET /me` - Get current user profile
- `PATCH /me` - Update user profile
- `GET /:id` - Get public user profile
- `GET /me/wallet` - Get wallet balance and Squad virtual account

### Discovery (`/discover`)

- `POST /broadcast` - Register BLE token
- `POST /resolve` - Resolve BLE tokens to nearby users
- `GET /qr` - Get current user's QR token
- `POST /qr/resolve` - Resolve scanned QR token
- `DELETE /broadcast` - Remove BLE token

### Transactions (`/transactions`)

- `POST /transfer` - Initiate transfer with fraud pre-scoring
- `GET` - Get transaction history
- `GET /:id` - Get transaction detail
- `GET /:id/fraud-detail` - Get fraud scoring details

### Notifications (`/notifications`)

- `POST /register-device` - Register FCM device token
- `GET` - Get notification history
- `PATCH /:id/read` - Mark notification as read

### Webhooks (`/webhooks`)

- `POST /squad` - Squad payment webhook receiver

## Third-Party Integrations

### Squad (Payment Processing)
- Virtual account creation and management
- Account name lookup
- Fund transfer execution
- Transaction history

### Firebase Cloud Messaging (FCM)
- Push notifications for payments
- Real-time transaction updates

### Redis (Upstash)
- BLE token storage (3-minute TTL)
- Session caching

### Termii (SMS OTP)
- OTP generation and delivery
- Nigeria-optimized provider

### PostgreSQL (Neon)
- Primary database via Prisma ORM

### Python Fraud Model (Backend 2)
- Transaction risk scoring (0-100)
- Fraud verdict generation (ALLOW/FLAG/BLOCK)
- Feature attribution

## Development Workflow

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally: `npm run start:dev`
3. Verify Swagger docs: http://localhost:3000/docs
4. Build for production: `npm run build`
5. Commit and push with clear messages

## Common Issues

### "Cannot find module" errors
Run `npm install` to ensure dependencies are installed

### Database connection errors
Verify `DATABASE_URL` in `.env` is correct

### Port 3000 already in use
Change `PORT` in `.env` or kill the process using it

### Prisma migration issues
```bash
npm run prisma:generate
npm run prisma:migrate
```

## Backend 1 Responsibilities

This codebase is owned by Backend 1 and handles:

✅ OTP-based phone authentication (Termii)
✅ User profile management
✅ Squad virtual account provisioning
✅ BLE/QR discovery for nearby users
✅ Transaction initiation with idempotency
✅ Real-time notifications (FCM + WebSocket)
✅ Squad webhook processing

⚠️ **Note:** Fraud scoring and admin dashboard are Backend 2 responsibilities.

## Contributing

Follow the API contract. Any endpoint changes must be communicated to the team immediately.

## License

ISC
