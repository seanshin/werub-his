import { Module } from '@nestjs/common';
import { HomepagePopupController } from './homepage-popup.controller';
import { HomepagePopupService } from './homepage-popup.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HomepagePopupController],
  providers: [HomepagePopupService],
  exports: [HomepagePopupService],
})
export class HomepagePopupModule {}
