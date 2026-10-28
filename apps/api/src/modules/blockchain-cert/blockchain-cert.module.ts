import { Module } from '@nestjs/common';
import { BlockchainCertController } from './blockchain-cert.controller';
import { BlockchainCertService } from './blockchain-cert.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // 🔴 NotificationModule 이 빠지면 '안내 발송'이 다시 보낸 척(미주입 400)으로 주저앉는다
  imports: [ConfigRuntimeModule, NotificationModule],
  controllers: [BlockchainCertController],
  providers: [BlockchainCertService],
  exports: [BlockchainCertService],
})
export class BlockchainCertModule {}
