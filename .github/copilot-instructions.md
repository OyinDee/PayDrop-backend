# PayDrop Backend API - Development Guide

## Project Overview
NestJS backend for PayDrop peer-to-peer payment platform. Core responsibilities:
- OTP-based authentication (Termii SMS)
- User profiles with Squad virtual accounts
- BLE/QR discovery for nearby users
- Transaction processing with Squad integration
- Real-time notifications (WebSocket + FCM)
- Idempotency and fraud pre-scoring

**Backend 1 Responsibilities:** Auth, Users, Discovery, Transactions, Notifications, Squad Webhooks

## Setup Instructions

### Environment Variables
Create `.env` file in project root:
```env
# Squad
SQUAD_SECRET_KEY=sandbox_sk_...
SQUAD_PUBLIC_KEY=sandbox_pk_...
SQUAD_BASE_URL=https://sandbox-api-d.squadco.com
SQUAD_WEBHOOK_SECRET=<webhook_secret>

# Database
DATABASE_URL=postgresql://user:pass@neon.tech/paydrop

# Redis
REDIS_URL=redis://your-upstash-url

# JWT
JWT_ACCESS_SECRET=<random_64_char_string>
JWT_REFRESH_SECRET=<random_64_char_string>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Firebase
FIREBASE_PROJECT_ID=paydrop
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...

# Termii
TERMII_API_KEY=...


# Fraud Service
FRAUD_SERVICE_URL=http://localhost:8000

# App
PORT=3000
NODE_ENV=development
```

### Installation & Running
```bash
npm install
npx prisma migrate dev
npm run start:dev
```

## Project Structure
- `src/auth/` - OTP & JWT authentication
- `src/users/` - User profiles & wallets
- `src/discover/` - BLE token management
- `src/transactions/` - Payment flows & idempotency
- `src/notifications/` - FCM & WebSocket
- `src/webhooks/` - Squad inbound webhooks
- `src/common/` - Guards, pipes, interceptors
- `prisma/` - Database schema

## API Documentation
Base URL: `http://localhost:3000/api/v1`
All endpoints (except auth) require JWT Bearer token.

See `API_CONTRACT.md` for complete endpoint specifications.
