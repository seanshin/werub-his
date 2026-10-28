import { Module } from '@nestjs/common';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';
import { IndicatorSupplierService } from './indicator-supplier.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
@Module({
   imports: [ConfigRuntimeModule], controllers: [QualityController], providers: [QualityService, IndicatorSupplierService], exports: [QualityService, IndicatorSupplierService] })
export class QualityModule {}
