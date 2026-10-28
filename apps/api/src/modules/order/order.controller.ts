import { Controller, Get, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, Request, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { UserRole, OrderDepartment } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderTrackingService } from './order-tracking.service';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { RecordOrderResultDto } from './dto/record-order-result.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { assertKnownQueryKeys } from '../../common/known-query-keys';

/**
 * 오더 목록 EP 가 받는 필터 키 — 여기에 없는 키는 400(조용히 버리지 않는다 · `assertKnownQueryKeys`).
 * 🔴 새 필터를 받으려면 아래 `@Query` 와 이 목록을 **함께** 늘린다.
 */
export const ORDER_LIST_QUERY_KEYS = [
  'department', 'status', 'doctorId', 'type', 'from', 'to', 'priority', 'page', 'limit',
  'careContext', 'nightOnly', 'patientId', 'prescribedBy', 'mine',
] as const;

/** `mine` 쿼리 해석 — true/1 · false/0 · 없음만 받는다(그 외는 400 · 조용히 무시하지 않는다) */
export function parseMineFlag(v?: string): boolean {
  if (v === undefined || v === '' || v === 'false' || v === '0') return false;
  if (v === 'true' || v === '1') return true;
  throw new BadRequestException('mine 은 true 또는 false 만 받습니다');
}

@ApiTags('Orders (OCS)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/orders')
export class OrderController {
  constructor(private readonly orderService: OrderService, private readonly tracking: OrderTrackingService) {}

  @Get()
  // 🔴 (2026-09-16 E3) 전 환자 오더 목록이 역할 없이 열려 있었다(급양·CRM·READ 포함) —
  //    형제 `queue/:department`(약사·검사·관리자)·`:id/status`(임상 5역할)만 막혀 있었다.
  //    소비 화면: /orders(임상)·/imaging(영상)·/nurse-station(간호)·/workstation/attending(의사)·역할별 대시보드.
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오더 목록 (부서/상태/의사/유형/날짜/긴급도/진료맥락·야간 필터)' })
  async findAll(
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('doctorId') doctorId?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    // 신규 파라미터는 **맨 뒤에** 붙인다 — @Query 는 위치 인자라, 중간에 끼우면
    // 위치로 호출하는 쪽(테스트·내부 호출)의 인자가 통째로 밀린다.
    @Query('careContext') careContext?: string,
    @Query('nightOnly') nightOnly?: string,
    @Query('patientId') patientId?: string,
    // 🔴 (2026-09-30) 주치의 워크스테이션 "내 대기 오더"가 `prescribedBy` 를, 대시보드 '검사결과 도착'이 `mine=true` 를
    //    보냈는데 서버가 **둘 다 받지 않아** 병원 전체 오더를 "내 것"으로 그렸다.
    //    `prescribedBy` = 책임 처방의(prescriberId ?? createdBy) · `mine` = "내 오더" 정본(my-orders-scope — 처방의·입력자·진료의).
    //    `doctorId` 는 진료의(encounter.doctorId) 기준이라 뜻이 다르다. 해석할 수 없는 값·모르는 키는 400.
    @Query('prescribedBy', new ParseUUIDPipe({ optional: true })) prescribedBy?: string,
    @Query('mine') mine?: string,
    @Query() rawQuery?: Record<string, unknown>,
    @CurrentUser('id') currentUserId?: string,
  ) {
    assertKnownQueryKeys(rawQuery, ORDER_LIST_QUERY_KEYS);
    const mineOn = parseMineFlag(mine);
    if (mineOn && prescribedBy && prescribedBy !== currentUserId) {
      throw new BadRequestException({ code: 'CONFLICTING_FILTERS', message: 'mine=true conflicts with prescribedBy of another user' });
    }
    return this.orderService.findAll({
      department, status, doctorId, type, from, to, priority, careContext,
      nightOnly: nightOnly === 'true' || nightOnly === '1',
      patientId,
      prescribedBy,
      mine: mineOn,
      mineUserId: mineOn ? currentUserId : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('tracking')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오더 실시간 추적 — 고른 날 발행분 + 아직 끝나지 않은 오더 · 단계(도메인 원장)·국면·경과·부서 요약·환자×부서 매트릭스' })
  async getTracking(@Query('date') date?: string, @Query('department') department?: string) {
    return { data: await this.tracking.getTracking(date, department) };
  }

  @Get('tracking/patient/:patientId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오더 추적 환자 드릴다운 — 최근 7일 + 끝나지 않은 오더 · 단계·결과(검사 수치/영상 판독/조제)·사람·처방 세부·확인 사항' })
  async getTrackingPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.tracking.getPatientDetail(patientId) };
  }

  @Get('queue/:department')
  @Roles(UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '부서별 대기열' })
  async getQueue(@Param('department') department: OrderDepartment) {
    const orders = await this.orderService.getQueue(department);
    return { data: orders };
  }

  @Patch(':id/status')
  // NURSE(간호·식이·활동 오더 시행 체크)·DOCTOR(자기 오더 취소/추적) 추가 — 시행자 기록은 userId로 남는다
  @Roles(UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '오더 상태 변경' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeOrderStatusDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    const order = await this.orderService.changeStatus(id, dto.status, dto.notes, (req.user.id ?? req.user.sub)!);
    return { data: order };
  }

  /**
   * 결과 기록(치료·간호·활동·식이) — 요약·소견·실제 시행 시각 · 정정은 새 항목 · complete=true 면 완료까지.
   * 누가 기록할 수 있는지는 서비스(canExecuteOrder)가 직종으로 가른다. 검사·영상·약은 전용 원장(400 + 안내).
   */
  @Post(':id/result')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '오더 결과·시행 기록(범용 유형) — 덧붙이기만·정정은 AMENDMENT' })
  async recordResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordOrderResultDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.orderService.recordResult(id, dto, (req.user.id ?? req.user.sub)!) };
  }

  @Post(':id/result/attachments')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '오더 결과지 첨부(jpeg/png/webp/pdf·10MB) — 지우지 않는다' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), 'uploads', 'order-results');
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
      cb(ok ? null : new BadRequestException('jpeg/png/webp/pdf 파일만 첨부할 수 있습니다'), ok);
    },
  }))
  async addResultAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    if (!file) throw new BadRequestException('file 필드에 파일을 첨부하세요');
    // multer 는 originalname 을 latin1 로 파싱 — 한글 파일명 복원(동의서 첨부와 같은 처리)
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return {
      data: await this.orderService.addResultAttachment(id, {
        url: `/uploads/order-results/${file.filename}`, fileName, mimeType: file.mimetype, size: file.size,
      }, (req.user.id ?? req.user.sub)!),
    };
  }
}
