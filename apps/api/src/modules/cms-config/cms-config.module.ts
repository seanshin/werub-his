import { Module } from '@nestjs/common';
import { CmsConfigController } from './cms-config.controller';
import { CmsConfigService } from './cms-config.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CmsConfigController],
  providers: [CmsConfigService],
  exports: [CmsConfigService],
})
export class CmsConfigModule {}
