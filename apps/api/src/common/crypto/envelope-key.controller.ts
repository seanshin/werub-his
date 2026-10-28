import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EnvelopeKeyService } from './envelope-key.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';

// 봉투 암호화 키 관리(ADMIN) — HSM 기획 Phase 3. 현재는 키 관리 계층만(field-encryption 미연동).
@ApiTags('Encryption Key (envelope)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/encryption-keys')
export class EnvelopeKeyController {
  constructor(private readonly svc: EnvelopeKeyService) {}

  @Get('status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '봉투 암호화 준비 상태(KEK 수탁·ACTIVE DEK·소비여부)' })
  async status() {
    return { data: await this.svc.status() };
  }

  @Post('rotate-dek')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DEK 회전 — 현 ACTIVE 은퇴 + 새 ACTIVE 발급(기존 데이터 영향 없음)' })
  async rotateDek() {
    return { data: await this.svc.rotateDek() };
  }
}
