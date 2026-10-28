import { Controller, Get, Patch, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerbalCosignService } from './verbal-cosign.service';

/** 구두·전화 처방 처방의 사후 확인 — 목록은 **내가 책임 처방의인 것만**, 확인도 책임 처방의만(서비스가 판정) */
@ApiTags('Prescriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/prescriptions/verbal-cosign')
export class VerbalCosignController {
  constructor(private readonly service: VerbalCosignService) {}

  @Get('pending')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '내가 확인해야 할 구두·전화 처방(처방의 사후 확인 대기)' })
  async pending(@CurrentUser('id') userId: string) {
    return { data: await this.service.listPending(userId) };
  }

  @Patch(':id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '구두·전화 처방 처방의 사후 확인(책임 처방의만 · 한 번)' })
  async cosign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.cosign(id, userId) };
  }
}
