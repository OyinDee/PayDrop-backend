import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer as NestWsServer,
} from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer as WsServer } from 'ws';
import { JwtTokenService } from '../common/services/jwt-token.service';

type OutgoingType =
  | 'hello'
  | 'pong'
  | 'balance.updated'
  | 'transaction.updated'
  | 'payment.received'
  | 'error';

interface ClientState {
  userId: string;
  alive: boolean;
}

/**
 * Plain JSON WebSocket at /ws (requirements Q10 — no Socket.IO client).
 *
 * Auth: `Authorization: Bearer <access token>` on the handshake. A `?token=`
 * query parameter is accepted for local debugging only.
 *
 * Every server frame is `{ id, type, ts, data }`; every client frame may carry
 * an `id`, echoed back in the reply so the app can correlate. Supported client
 * types: `ping`.
 */
@WebSocketGateway({ path: '/ws' })
@Injectable()
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly clients = new Map<WebSocket, ClientState>();
  private heartbeat?: NodeJS.Timeout;

  @NestWsServer()
  server: WsServer;

  constructor(private readonly jwtTokenService: JwtTokenService) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const userId = this.authenticate(request);

    if (!userId) {
      client.close(4401, 'unauthorized');
      return;
    }

    this.clients.set(client, { userId, alive: true });

    client.on('pong', () => {
      const state = this.clients.get(client);
      if (state) state.alive = true;
    });

    client.on('message', (raw) => this.onMessage(client, raw.toString()));

    this.startHeartbeat();

    this.send(client, 'hello', {
      user_id: userId,
      socket: 'notifications',
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  // ── inbound ────────────────────────────────────────────────

  private onMessage(client: WebSocket, raw: string): void {
    let frame: any;

    try {
      frame = JSON.parse(raw);
    } catch {
      this.send(client, 'error', {
        code: 'BAD_REQUEST',
        message: 'Messages must be JSON.',
      });
      return;
    }

    const type = frame?.type ?? frame?.event;

    if (type === 'ping') {
      this.reply(client, frame?.id, 'pong', {
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.reply(client, frame?.id, 'error', {
      code: 'UNKNOWN_TYPE',
      message: `Unsupported message type: ${type ?? '(none)'}`,
    });
  }

  // ── outbound ───────────────────────────────────────────────

  emitBalanceUpdated(userId: string, newBalance: bigint | number): void {
    this.emitToUser(userId, 'balance.updated', {
      balance: Number(newBalance),
      new_balance: Number(newBalance),
    });
  }

  emitTransactionUpdated(
    userId: string,
    transactionId: string,
    status: string,
    fraudScore?: number | null,
    verdict?: string | null,
  ): void {
    this.emitToUser(userId, 'transaction.updated', {
      transaction_id: transactionId,
      status,
      fraud_score: fraudScore ?? null,
      verdict: verdict ?? null,
    }, transactionId);
  }

  emitPaymentReceived(
    userId: string,
    amount: bigint | number,
    senderName: string,
    transactionId: string,
    newBalance: bigint | number,
  ): void {
    this.emitToUser(
      userId,
      'payment.received',
      {
        amount: Number(amount),
        sender_name: senderName,
        transaction_id: transactionId,
        balance: Number(newBalance),
        new_balance: Number(newBalance),
      },
      transactionId,
    );
  }

  private emitToUser(
    userId: string,
    type: OutgoingType,
    data: Record<string, unknown>,
    transactionId?: string,
  ): void {
    // Every server event needs a unique id: the app dedupes by it.
    const frame: Record<string, unknown> = {
      id: `evt_${randomUUID()}`,
      type,
      ts: new Date().toISOString(),
      ...(transactionId ? { transaction_id: transactionId } : {}),
      data,
    };
    const payload = JSON.stringify(frame);

    for (const [client, state] of this.clients) {
      if (state.userId === userId && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private send(client: WebSocket, type: OutgoingType, data: unknown): void {
    if (client.readyState !== WebSocket.OPEN) return;

    client.send(
      JSON.stringify({
        id: null,
        type,
        ts: new Date().toISOString(),
        data,
      }),
    );
  }

  private reply(
    client: WebSocket,
    id: unknown,
    type: OutgoingType,
    data: unknown,
  ): void {
    if (client.readyState !== WebSocket.OPEN) return;

    client.send(
      JSON.stringify({
        id: typeof id === 'string' || typeof id === 'number' ? id : null,
        type,
        ts: new Date().toISOString(),
        data,
      }),
    );
  }

  // ── plumbing ───────────────────────────────────────────────

  private authenticate(request: IncomingMessage): string | null {
    const header = request.headers['authorization'];
    let token: string | undefined;

    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      token = header.slice(7).trim();
    } else if (typeof request.url === 'string') {
      const match = request.url.match(/[?&]token=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) return null;

    try {
      return this.jwtTokenService.verifyAccessToken(token).sub ?? null;
    } catch {
      return null;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;

    this.heartbeat = setInterval(() => {
      for (const [client, state] of this.clients) {
        if (!state.alive) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }
        state.alive = false;
        try {
          client.ping();
        } catch {
          this.clients.delete(client);
        }
      }
    }, 30_000);

    this.heartbeat.unref?.();
  }
}
