import { Controller, Get, Query, Post, Put, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UserService } from './user.service';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUiPreferenceDto } from './dto/update-ui-preference.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SaveMySignatureDto } from './dto/update-user.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * 내 화면 표시 선호 — 기기 간 동기화(기획 medical-term-display-toggle.plan.md P2).
   * 🔴 자기 스코프(@CurrentUser)라 전 직원에게 연다 — 역할 목록은 shared 정본 파생
   *    (여기 다시 적으면 신설 직군이 따라오지 못한다 — ESS 403 사례).
   * 🔴 `:id` 라우트보다 먼저 선언한다 — 뒤에 두면 'me' 가 UUID 파이프에 걸려 400 이다.
   */
  @Get('me/ui-preferences')
  @Roles(...(EVERY_STAFF_ROLE as unknown as UserRole[]))
  @ApiOperation({ summary: '내 화면 표시 선호(용어 모드) — 미설정은 null' })
  async getMyUiPreferences(@CurrentUser('id') userId: string) {
    return { data: await this.userService.getUiPreferences(userId) };
  }

  @Put('me/ui-preferences')
  @Roles(...(EVERY_STAFF_ROLE as unknown as UserRole[]))
  @ApiOperation({ summary: '내 화면 표시 선호 저장 — 표시만 바꾼다(저장 값·인쇄 불변)' })
  async setMyUiPreferences(@Body() dto: UpdateUiPreferenceDto, @CurrentUser('id') userId: string) {
    return { data: await this.userService.setUiPreferences(userId, dto) };
  }

  @Get()
  /**
   * 🔴 혈액은행 워크스테이션(검사기사 nav)이 **수혈 2차 확인 간호사** 선택에 이 목록을 쓴다.
   *    LAB_TECH 가 403 이면 선택지가 비고 확인 버튼이 영원히 비활성이라
   *    **수혈 이중확인 절차를 끝낼 수 없다**(2026-08-30 실측). 직원 명부는 PHI 가 아니고
   *    반환 필드도 이름·역할·부서뿐이라 조회를 연다(생성·수정은 그대로 관리자).
   */
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH)
  @ApiOperation({ summary: '사용자 목록 (?role= 필터)' })
  async findAll(@Query('role') role?: string) {
    const all = await this.userService.findAll();
    // 🔴 종전엔 ?role= 을 조용히 무시하고 전 직원을 반환했다 — 호출부(수혈 2인확인·간호 인계
    //    인수자 선택)는 간호사만 온다고 믿고 있었다. 무시가 아니라 필터로.
    return { data: role ? all.filter((u) => u.role === String(role).toUpperCase()) : all };
  }

  @Get('doctors')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '의사 목록' })
  async findDoctors() {
    const all = await this.userService.findAll();
    return { data: all.filter((u) => u.role === 'DOCTOR') };
  }

  @Get('org-chart')
  @ApiOperation({ summary: '조직도 (부서별 그룹)' })
  async getOrgChart() {
    return { data: await this.userService.getOrgChart() };
  }

  @Get('me/signature')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '내 서명 이미지 조회' })
  async getMySignature(@CurrentUser('id') userId: string) {
    return { data: await this.userService.getSignature(userId) };
  }

  @Put('me/signature')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH)
  @ApiOperation({ summary: '내 서명 이미지 등록/수정' })
  async saveMySignature(@CurrentUser('id') userId: string, @Body() body: SaveMySignatureDto) {
    return { data: await this.userService.saveSignature(userId, body.signatureImage) };
  }

  @Post()
  @ApiOperation({ summary: '사용자 생성 (Admin)' })
  async create(@Body() dto: CreateUserDto) {
    return { data: await this.userService.create(dto) };
  }

  @Get(':id')
  @ApiOperation({ summary: '사용자 상세 (Admin)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.userService.findById(id) };
  }

  @Put(':id')
  @ApiOperation({ summary: '사용자 수정 (Admin)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return { data: await this.userService.update(id, dto) };
  }

  @Patch(':id/reset-password')
  @ApiOperation({ summary: '패스워드 초기화 (Admin)' })
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() body: ResetPasswordDto) {
    return { data: await this.userService.resetPassword(id, body.newPassword) };
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: '사용자 비활성화 (Admin)' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    await this.userService.deactivate(id);
    return { data: { message: 'User deactivated' } };
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: '사용자 활성화 (Admin)' })
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    await this.userService.activate(id);
    return { data: { message: 'User activated' } };
  }
}
