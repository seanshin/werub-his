import { Module } from '@nestjs/common';
import { RbacAdminController } from './rbac-admin.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RbacAdminController],
})
export class RbacAdminModule {}
