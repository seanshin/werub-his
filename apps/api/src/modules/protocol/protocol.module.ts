import { Module } from '@nestjs/common';
import { ProtocolController } from './protocol.controller';
import { ProtocolService } from './protocol.service';
import { ProtocolListener } from './protocol.listener';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { JourneyModule } from '../journey/journey.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [PrismaModule, NotificationModule, JourneyModule, ConfigRuntimeModule],
  controllers: [ProtocolController],
  providers: [ProtocolService, ProtocolListener],
  exports: [ProtocolService],
})
export class ProtocolModule {}
