import {
  Controller, Get, Post, Put, Patch, Param, Body, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ALLERGY_STATUS_ROLES } from '@hospital-run/shared';
import { AllergyService } from './allergy.service';
import { CreateAllergyDto } from './dto/create-allergy.dto';
import { UpdateAllergyDto } from './dto/update-allergy.dto';
import { VerifyAllergyDto } from './dto/verify-allergy.dto';
import { AssessAllergyDto } from './dto/assess-allergy.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Allergy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients/:patientId/allergies')
export class AllergyController {
  constructor(private readonly allergyService: AllergyService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '알레르기 등록' })
  async create(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateAllergyDto,
    @CurrentUser('id') userId: string,
  ) {
    const allergy = await this.allergyService.create(patientId, dto, userId);
    return { data: allergy };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 알레르기 목록' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('isActive') isActive?: string,
  ) {
    const active = isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    const allergies = await this.allergyService.findByPatient(patientId, active);
    return { data: allergies };
  }

  // ⚠ 리터럴 경로는 ':id' 파라미터 라우트보다 먼저 등록해야 함(Nest 매칭 선점 방지)
  @Get('status')
  // 🔴 역할 목록은 shared 정본 하나 — 화면(`canReadAllergyStatus`)이 같은 목록으로 호출 여부를 정한다.
  //    양쪽에 따로 적으면 갈라진다(가드 `allergy-status-roles.spec.ts` 가 일치를 강제).
  @Roles(...(ALLERGY_STATUS_ROLES as readonly UserRole[]))
  @ApiOperation({ summary: '알레르기 문진 상태(NKA/미문진/알레르기있음)' })
  async getStatus(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const status = await this.allergyService.getStatus(patientId);
    return { data: status };
  }

  @Post('assessment')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '알레르기 문진 기록(무알레르기 확인/문진 불가)' })
  async assess(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: AssessAllergyDto,
    @CurrentUser('id') userId: string,
  ) {
    const assessment = await this.allergyService.assess(patientId, dto, userId);
    return { data: assessment };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '알레르기 상세' })
  async findById(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const allergy = await this.allergyService.findById(patientId, id);
    return { data: allergy };
  }

  @Put(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '알레르기 수정' })
  async update(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllergyDto,
  ) {
    const allergy = await this.allergyService.update(patientId, id, dto);
    return { data: allergy };
  }

  @Patch(':id/verify')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '알레르기 검증 상태 변경' })
  async verify(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyAllergyDto,
  ) {
    const allergy = await this.allergyService.verify(patientId, id, dto);
    return { data: allergy };
  }
}
