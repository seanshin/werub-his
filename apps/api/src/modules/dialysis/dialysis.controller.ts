import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DialysisService } from './dialysis.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateDialysisOrderDto, UpdateDialysisOrderDto, GenerateSessionsDto,
  StartSessionDto, AddIntradialyticVitalsDto, CompleteSessionDto,
  AddComplicationDto, CreateMachineDto, UpdateMachineStatusDto,
} from './dto/dialysis.dto';

@ApiTags('Dialysis (투석실)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/dialysis')
export class DialysisController {
  constructor(private readonly service: DialysisService) {}

  /* ───── Orders ───── */

  @Post('orders')
  @ApiOperation({ summary: '투석 처방' })
  async createOrder(
    @Body() body: CreateDialysisOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createOrder({ ...body, prescribedBy: userId }) };
  }

  @Get('orders')
  @ApiOperation({ summary: '처방 목록' })
  async getOrders(
    @Query('patientId') patientId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return { data: await this.service.getOrders({
      patientId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    })};
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '처방 상세' })
  async getOrderDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getOrderDetail(id) };
  }

  @Patch('orders/:id')
  @ApiOperation({ summary: '처방 수정/종료' })
  async updateOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDialysisOrderDto,
  ) {
    return { data: await this.service.updateOrder(id, body) };
  }

  /* ───── Sessions ───── */

  @Post('sessions/generate')
  @ApiOperation({ summary: '월간 세션 자동 생성' })
  async generateSessions(@Body() body: GenerateSessionsDto) {
    return { data: await this.service.generateSessions(body) };
  }

  @Get('sessions')
  @ApiOperation({ summary: '세션 목록 (날짜/환자)' })
  async getSessions(
    @Query('date') date?: string,
    @Query('patientId') patientId?: string,
    @Query('shift') shift?: string,
  ) {
    return { data: await this.service.getSessions({ date, patientId, shift }) };
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: '세션 상세' })
  async getSessionDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getSessionDetail(id) };
  }

  @Patch('sessions/:id/start')
  @ApiOperation({ summary: '투석 시작 (전 활력징후)' })
  async startSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StartSessionDto,
  ) {
    return { data: await this.service.startSession(id, body) };
  }

  @Post('sessions/:id/vitals')
  @ApiOperation({ summary: '투석 중 활력징후' })
  async addVitals(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddIntradialyticVitalsDto,
  ) {
    const vitals = { ...body, time: new Date().toISOString() };
    return { data: await this.service.addIntradialyticVitals(id, vitals) };
  }

  @Patch('sessions/:id/complete')
  @ApiOperation({ summary: '투석 완료 (후 활력징후, Kt/V)' })
  async completeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteSessionDto,
  ) {
    return { data: await this.service.completeSession(id, body) };
  }

  @Post('sessions/:id/complication')
  @ApiOperation({ summary: '합병증 기록' })
  async addComplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddComplicationDto,
  ) {
    return { data: await this.service.addComplication(id, body) };
  }

  /* ───── Machines ───── */

  @Get('machines')
  @ApiOperation({ summary: '투석기 목록' })
  async getMachines(
    @Query('machineType') machineType?: string,
    @Query('status') status?: string,
  ) {
    return { data: await this.service.getMachines({ machineType, status }) };
  }

  @Post('machines')
  @ApiOperation({ summary: '투석기 등록' })
  async createMachine(@Body() body: CreateMachineDto) {
    return { data: await this.service.createMachine(body) };
  }

  @Patch('machines/:id/status')
  @ApiOperation({ summary: '투석기 상태 변경' })
  async updateMachineStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMachineStatusDto,
  ) {
    return { data: await this.service.updateMachineStatus(id, body.status) };
  }

  @Patch('machines/:id/disinfect')
  @ApiOperation({ summary: '소독 기록' })
  async disinfectMachine(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.disinfectMachine(id) };
  }

  /* ───── Dashboard / Stats ───── */

  @Get('dashboard')
  @ApiOperation({ summary: '투석실 대시보드' })
  async getDashboard() {
    return { data: await this.service.getDashboard() };
  }

  @Get('patients/:id/history')
  @ApiOperation({ summary: '환자 투석 이력' })
  async getPatientHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPatientHistory(id) };
  }

  @Get('stats')
  @ApiOperation({ summary: '투석 통계 (Kt/V 달성률, 합병증)' })
  async getStats() {
    return { data: await this.service.getStats() };
  }
}
