import { Controller, Get, Post, Put, Delete, Param, Body, Query, Headers, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { WorkstationSetupService } from './workstation-setup.service';
import { PrintService } from './print.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpsertWorkstationDto, UpsertPeripheralDto, PrintJobDto, PrintOrderLabelDto, SetStationOrderCodesDto } from './dto/workstation-setup.dto';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';

/**
 * 🔴 자리 해석·목록은 **전 직군**이다 — 상단 바의 워크스테이션 배지가 로그인한 모든 직원 화면에 렌더된다.
 *    2026-08-26 실측: 여기가 임상 5역할이라 **14역할 중 9역할이 모든 화면에서 403** 을 받고 있었다.
 *    바로 위 주석은 이미 "정체성 해석(모든 직원)"이라 적혀 있었는데 **코드가 그것을 어기고 있었다.**
 *    (2026-08-21 위급검사값 배너와 같은 결함 — 전역 컴포넌트는 최소 권한 직군으로 검증한다.)
 *    자리 정보는 PHI 가 아니라 장소·프린터 이름이므로 여는 것이 답이다.
 */
const WS_READ_ROLES = EVERY_STAFF_ROLE.map((r) => r as UserRole);

@ApiTags('Workstation Setup (워크스테이션-디바이스)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/workstation-setup')
export class WorkstationSetupController {
  constructor(private readonly svc: WorkstationSetupService, private readonly print: PrintService) {}

  // ── 정체성 해석(모든 직원) ──

  @Get('resolve')
  @Roles(...WS_READ_ROLES)
  @ApiOperation({ summary: '현재 워크스테이션 해석(단말 자동 or code 선택)' })
  async resolve(@Headers('x-device-uuid') deviceUuid?: string, @Query('code') code?: string) {
    return { data: await this.svc.resolve(deviceUuid, code) };
  }

  @Get('pick-list')
  @Roles(...WS_READ_ROLES)
  @ApiOperation({ summary: '워크스테이션 선택 목록(경량)' })
  async pickList() {
    return { data: await this.svc.pickList() };
  }

  @Get('logical-stations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '논리 스테이션 목록(매핑 편집용)' })
  async logicalStations() {
    return { data: await this.svc.listLogicalStations() };
  }

  @Get('logical-stations/:stationId/order-codes')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '논리 스테이션 검사항목(수가코드) 설정 조회 — 마스터 대조 결과 포함' })
  async getStationOrderCodes(@Param('stationId') stationId: string) {
    return { data: await this.svc.getStationOrderCodes(stationId) };
  }

  @Put('logical-stations/:stationId/order-codes')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '논리 스테이션 검사항목(수가코드) 설정 저장 — 기초검사 자리는 제외' })
  async setStationOrderCodes(@Param('stationId') stationId: string, @Body() dto: SetStationOrderCodesDto) {
    return { data: await this.svc.setStationOrderCodes(stationId, dto.orderCodes) };
  }

  // ── 관리(ADMIN) ──

  @Get('workstations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '워크스테이션+주변기기 목록' })
  async list() {
    return { data: await this.svc.listWorkstations() };
  }

  @Post('workstations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '워크스테이션 등록/수정(code upsert)' })
  async upsertWs(@Body() dto: UpsertWorkstationDto) {
    return { data: await this.svc.upsertWorkstation(dto) };
  }

  @Delete('workstations/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '워크스테이션 삭제(+주변기기)' })
  async deleteWs(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deleteWorkstation(id) };
  }

  @Get('terminals/available')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '바인딩용 미할당 단말 목록' })
  async terminals() {
    return { data: await this.svc.availableTerminals() };
  }

  @Post('peripherals')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '주변기기 등록(프린터·스캐너 등)' })
  async createPeripheral(@Body() dto: UpsertPeripheralDto) {
    return { data: await this.svc.upsertPeripheral(null, dto) };
  }

  @Put('peripherals/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '주변기기 수정(연결/프린터 설정 조정)' })
  async updatePeripheral(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertPeripheralDto) {
    return { data: await this.svc.upsertPeripheral(id, dto) };
  }

  @Delete('peripherals/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '주변기기 삭제' })
  async deletePeripheral(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.deletePeripheral(id) };
  }

  // ── P2: 실 I/O(네트워크 프린터·raw 9100) ──

  @Post('peripherals/:id/test-print')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '프린터 테스트 인쇄(연결 검증·내부망 IP만)' })
  async testPrint(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.print.testPrint(id) };
  }

  @Post('print')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '워크스테이션 기본 프린터로 인쇄(라벨/문서)' })
  async printJob(@Body() dto: PrintJobDto) {
    return { data: await this.print.printJob({ workstationProfileId: dto.workstationProfileId, code: dto.code, kind: dto.kind as 'LABEL' | 'DOC', payload: dto.payload }) };
  }

  @Post('print/order-label')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '오더 검체/조제 라벨 원버튼 인쇄 — 서버측 ZPL 조립+기본 라벨프린터 송출(비NETWORK면 zpl 반환)' })
  async printOrderLabel(@Body() dto: PrintOrderLabelDto) {
    return { data: await this.print.printOrderLabel(dto) };
  }
}
