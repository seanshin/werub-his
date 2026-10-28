import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EmergencyPathwayService } from './emergency-pathway.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivatePathwayDto, CompleteMilestoneDto, CancelPathwayDto } from './dto/emergency-pathway.dto';

@ApiTags('Emergency Golden Pathway (골든타임 프로토콜)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/emergency-pathways')
export class EmergencyPathwayController {
  constructor(private readonly svc: EmergencyPathwayService) {}

  @Get('templates')
  @ApiOperation({ summary: '프로토콜 3종 템플릿(STEMI/뇌졸중/패혈증)' })
  getTemplates() { return { data: this.svc.getTemplates() }; }

  @Get('active')
  @ApiOperation({ summary: '활성 골든타임 프로토콜(경과·목표·마일스톤)' })
  async getActive() { return { data: await this.svc.getActive() }; }

  @Get('patient/:patientId')
  @ApiOperation({ summary: '환자별 프로토콜 이력' })
  async getByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.getByPatient(patientId) };
  }

  @Post()
  @ApiOperation({ summary: '프로토콜 활성화' })
  async activate(@Body() dto: ActivatePathwayDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.activate(dto, userId) };
  }

  @Patch(':id/milestone')
  @ApiOperation({ summary: '마일스톤 완료(타임스탬프)' })
  async completeMilestone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteMilestoneDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.completeMilestone(id, dto.key, userId) };
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: '프로토콜 완료(핵심지표 소요분 산출)' })
  async complete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.complete(id) };
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: '프로토콜 취소' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPathwayDto) {
    return { data: await this.svc.cancel(id, dto.reason) };
  }
}
