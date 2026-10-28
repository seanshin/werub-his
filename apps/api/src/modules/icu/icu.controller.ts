import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IcuService } from './icu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdmitIcuDto, AddIcuRecordDto, UpdateVentilatorDto } from './dto/icu.dto';
import {
  IcuCrrtDto, IcuDischargeDto, IcuEcmoDto, IcuInfectionBundleDto, IcuSedationDto, IcuSepsisBundleDto, IcuWeaningTrialDto,
} from './dto/icu-bundle.dto';

@ApiTags('ICU')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/icu')
export class IcuController {
  constructor(private readonly icuService: IcuService) {}

  @Get('beds')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: 'ICU 병상 현황' })
  async getBeds() { return { data: await this.icuService.getBeds() }; }

  @Get('patients')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: 'ICU 입실 환자 목록' })
  async getPatients() { return { data: await this.icuService.getPatients() }; }

  @Get('dashboard')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: 'ICU 대시보드 통계' })
  async getDashboard() { return { data: await this.icuService.getDashboard() }; }

  @Get('alerts/news2')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: 'NEWS2 조기경고 알림 목록' })
  async getNews2Alerts() {
    return { data: await this.icuService.getNews2Alerts() };
  }

  @Post('admit')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'ICU 입실' })
  async admit(@Body() body: AdmitIcuDto, @CurrentUser('id') doctorId: string) {
    return { data: await this.icuService.admit({
      patientId: body.patientId,
      icuBedId: body.icuBedId,
      admitReason: body.admitReason,
      severity: body.severity,
      ventilator: body.ventilator,
      isolation: body.isolation,
      doctorId,
    }) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ICU 입실 상세 (I/O 합계 포함)' })
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.icuService.getPatientDetail(id) };
  }

  @Patch(':id/discharge')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'ICU 퇴실(병동 전동 시 인수의 지정하면 SBAR 핸드오프 생성)' })
  async discharge(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string, @Body() body: IcuDischargeDto) {
    return { data: await this.icuService.discharge(id, userId, body) };
  }

  @Post(':id/record')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'ICU 기록 등록 (바이탈/I-O/인공호흡기/중증도)' })
  async addRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddIcuRecordDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.addRecord(id, { ...body, recordedBy: userId }) };
  }

  @Get(':id/records')
  @ApiOperation({ summary: 'ICU 기록 조회 (시계열)' })
  async getRecords(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.icuService.getRecords(id) };
  }

  @Get(':id/flowsheet')
  @ApiOperation({ summary: 'ICU 플로우시트 (최근 24시간)' })
  async getFlowsheet(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.icuService.getFlowsheet(id) };
  }

  @Patch(':id/ventilator')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '인공호흡기 설정 변경' })
  async updateVentilator(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateVentilatorDto, @CurrentUser('id') userId: string) {
    return { data: await this.icuService.updateVentilator(id, body, userId) };
  }

  @Get(':id/apache')
  /**
   * 🔴 중증도 점수는 **중환자실 간호사의 일상 업무**다(교대 인수인계·모니터링의 기준값).
   *    계산은 기록된 값에서 **산출**할 뿐 임상 판단을 쓰지 않는데 의사에게만 열려 있어,
   *    /icu 화면(간호사 nav)에서 두 카드가 상시 403 이었다(2026-08-30).
   *    퇴실 결정(`PATCH :id/discharge`)은 의사 그대로 둔다 — 성격이 다르다.
   */
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'APACHE II 스코어 계산' })
  async calculateApache(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.icuService.calculateApache(id) };
  }

  @Get(':id/sofa')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'SOFA 스코어 계산' })
  async calculateSofa(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.icuService.calculateSofa(id) };
  }

  @Post(':id/sepsis-bundle')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '패혈증 1h/3h 번들 체크리스트 기록 — 저장 모델 없음: recorded:false·NOT_PERSISTED 반환(2026-09-15)' })
  async recordSepsisBundle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IcuSepsisBundleDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.recordSepsisBundle(id, { ...body, recordedBy: userId }) };
  }

  @Post(':id/infection-bundle')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '감염 번들 기록 (VAP/CLABSI/CAUTI) — 저장 모델 없음: recorded:false·NOT_PERSISTED 반환(2026-09-15)' })
  async recordInfectionBundle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IcuInfectionBundleDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.recordInfectionBundle(id, { ...body, recordedBy: userId }) };
  }

  @Post(':id/sedation')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '진정/진통 평가 (RASS, BPS, CAM-ICU) — 저장 모델 없음: recorded:false·NOT_PERSISTED 반환(2026-09-15)' })
  async recordSedation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IcuSedationDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.recordSedation(id, { ...body, recordedBy: userId }) };
  }

  @Post(':id/crrt')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'CRRT 설정/모니터링 기록 — 저장 모델 없음: recorded:false·NOT_PERSISTED 반환(2026-09-15)' })
  async recordCrrt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IcuCrrtDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.recordCrrt(id, { ...body, recordedBy: userId }) };
  }

  @Post(':id/ecmo')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'ECMO 회로/설정/합병증 기록 — 저장 모델 없음: recorded:false·NOT_PERSISTED 반환(2026-09-15)' })
  async recordEcmo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IcuEcmoDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.recordEcmo(id, { ...body, recordedBy: userId }) };
  }

  @Post(':id/weaning-trial')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'SBT 결과 + 인공호흡기 이탈 결정 — 저장 모델 없음: recorded:false·NOT_PERSISTED 반환(2026-09-15)' })
  async recordWeaningTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: IcuWeaningTrialDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.icuService.recordWeaningTrial(id, { ...body, recordedBy: userId }) };
  }
}
