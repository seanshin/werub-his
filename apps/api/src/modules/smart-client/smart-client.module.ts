import { Module } from '@nestjs/common';
import { SmartClientController } from './smart-client.controller';
import { SmartClientService } from './smart-client.service';
import { SmartAccessService } from './smart-access.service';

@Module({
  controllers: [SmartClientController],
  providers: [SmartClientService, SmartAccessService],
  exports: [SmartClientService, SmartAccessService],
})
export class SmartClientModule {}
