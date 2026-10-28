import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DeviceUsageService } from './device-usage.service';
import { RecordDeviceUsageDto, ScanBarcodeDto } from './dto/device-usage.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 의료기기 사용·삽입 기록과 리콜 역추적(GS1 GTIN-13/14 · UDI).
 *
 * 🔴 리콜 조회는 **환자 명단을 돌려준다** — 임상·관리 역할로 제한한다.
 */
@ApiTags('Device Usage (의료기기 사용·리콜)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/device-usage')
export class DeviceUsageController {
  constructor(private readonly svc: DeviceUsageService) {}

  /** 🔴 미리보기 — **아무것도 저장하지 않는다**(스캔한 것을 사람이 보고 넣는다) */
  @Post('scan')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '바코드 파싱 미리보기(GTIN·로트·유효기간·일련번호) — 저장하지 않음' })
  async scan(@Body() body: ScanBarcodeDto) {
    return { data: await this.svc.scan(body.barcode) };
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '기기 사용·삽입 기록 — 바코드 원문 보존·체크디지트 결과 병기' })
  async record(@Body() body: RecordDeviceUsageDto, @CurrentUser('id') userId: string) {
    return this.svc.record(body, userId);
  }

  /**
   * 🔴 **리콜 역추적** — 이 GTIN/로트가 어느 환자에게 들어갔는가.
   *    이것이 없으면 리콜 공고를 받아도 아무것도 할 수 없다.
   *    🔴 결과 0건은 "해당 없음"이 아니다 — 응답의 `caveat` 이 그 한계를 말한다.
   */
  @Get('recall')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '리콜 역추적 — GTIN·로트·일련번호로 사용 환자 조회' })
  async recall(
    @Query('gtin') gtin?: string,
    @Query('lotNumber') lotNumber?: string,
    @Query('serialNumber') serialNumber?: string,
  ) {
    return { data: await this.svc.recallLookup({ gtin, lotNumber, serialNumber }) };
  }

  @Get('patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자에게 사용된 기기 이력' })
  async byPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.byPatient(patientId) };
  }
}
