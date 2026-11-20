-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "payer_id" TEXT,
    "amount" BIGINT NOT NULL,
    "note" TEXT,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'OPEN',
    "share_code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_contributions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_reactions" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_share_code_key" ON "payment_requests"("share_code");

-- CreateIndex
CREATE INDEX "payment_requests_requester_id_status_idx" ON "payment_requests"("requester_id", "status");

-- CreateIndex
CREATE INDEX "payment_requests_payer_id_idx" ON "payment_requests"("payer_id");

-- CreateIndex
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_contributions_transaction_id_key" ON "payment_contributions"("transaction_id");

-- CreateIndex
CREATE INDEX "payment_contributions_request_id_idx" ON "payment_contributions"("request_id");

-- CreateIndex
CREATE INDEX "payment_contributions_payer_id_idx" ON "payment_contributions"("payer_id");

-- CreateIndex
CREATE INDEX "transfer_reactions_transaction_id_idx" ON "transfer_reactions"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_reactions_transaction_id_user_id_emoji_key" ON "transfer_reactions"("transaction_id", "user_id", "emoji");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_contributions" ADD CONSTRAINT "payment_contributions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_contributions" ADD CONSTRAINT "payment_contributions_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_contributions" ADD CONSTRAINT "payment_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_reactions" ADD CONSTRAINT "transfer_reactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_reactions" ADD CONSTRAINT "transfer_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
