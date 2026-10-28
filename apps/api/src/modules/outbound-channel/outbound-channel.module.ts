import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { OutboundChannelController, AgencyIntegrationController } from './outbound-channel.controller';
import { OutboundChannelService } from './outbound-channel.service';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [OutboundChannelController, AgencyIntegrationController],
  providers: [OutboundChannelService],
  exports: [OutboundChannelService],
})
export class OutboundChannelModule {}
