import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtTokenService } from '../common/services/jwt-token.service';

@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: '*' },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtTokenService: JwtTokenService) {}

  handleConnection(@ConnectedSocket() client: Socket): void {
    const token = client.handshake.query?.token;
    if (!token || typeof token !== 'string') {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtTokenService.verifyAccessToken(token);
      client.data.userId = payload.sub;
      client.join(payload.sub);
    } catch {
      client.disconnect();
    }
  }

  emitBalanceUpdated(userId: string, newBalance: bigint | number): void {
    this.server.to(userId).emit('balance.updated', {
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
    this.server.to(userId).emit('transaction.updated', {
      transaction_id: transactionId,
      status,
      fraud_score: fraudScore ?? null,
      verdict: verdict ?? null,
    });
  }

  emitPaymentReceived(
    userId: string,
    amount: bigint | number,
    senderName: string,
    transactionId: string,
    newBalance: bigint | number,
  ): void {
    this.server.to(userId).emit('payment.received', {
      amount: Number(amount),
      sender_name: senderName,
      transaction_id: transactionId,
      new_balance: Number(newBalance),
    });
  }
}
