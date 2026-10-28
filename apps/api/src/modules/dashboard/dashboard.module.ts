import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardConfigController } from './dashboard-config.controller';
import { DashboardConfigService } from './dashboard-config.service';
import { DashboardTemplateController } from './dashboard-template.controller';

@Module({
  controllers: [DashboardController, DashboardConfigController, DashboardTemplateController],
  providers: [DashboardService, DashboardConfigService],
})
export class DashboardModule {}
