import { Global, Module } from '@nestjs/common';
import { TrustService } from './trust.service';

/**
 * Cross-cutting services that only depend on PrismaService. Global so feature
 * modules (auth, users, discover, transactions) share one instance.
 */
@Global()
@Module({
  providers: [TrustService],
  exports: [TrustService],
})
export class CommonServicesModule {}
