import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BreakGlassService } from './break-glass.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BreakGlassGrantDto } from './dto/break-glass.dto';

// 책임자(인증된 ADMIN/DOCTOR)가 인증불가 직원에게 응급 접근을 부여(=승인)
@ApiTags('break-glass')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/break-glass')
export class BreakGlassController {
  constructor(private readonly svc: BreakGlassService) {}

  @Post('grant')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '응급 접근 부여(책임자 승인, 시간제한 토큰)' })
  async grant(@CurrentUser('id') approverId: string, @Body() body: BreakGlassGrantDto) {
    return { data: await this.svc.grant(approverId, body) };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '응급 접근 감사 목록(보안 검토)' })
  async list() {
    return { data: await this.svc.list() };
  }

  @Post(':id/review')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사후 의무 검토 완료' })
  async review(@CurrentUser('id') reviewerId: string, @Param('id') id: string) {
    return { data: await this.svc.review(reviewerId, id) };
  }
}
