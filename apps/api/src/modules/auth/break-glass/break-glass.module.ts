import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassService } from './break-glass.service';
import { NotificationModule } from '../../notification/notification.module';
import { ConfigRuntimeModule } from '../../config/config-runtime.module';

@Module({
  imports: [JwtModule.register({}), NotificationModule, ConfigRuntimeModule], // security.btg.* 소비(§7 P2)
  controllers: [BreakGlassController],
  providers: [BreakGlassService],
  exports: [BreakGlassService],
})
export class BreakGlassModule {}
