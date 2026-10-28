import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, ParseUUIDPipe, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EncryptionService } from './services/encryption.service';
import { PatientAccountAuthGuard } from './guards/patient-account-auth.guard';
import { PatientAuthService } from './patient-auth.service';
import { UpdatePatientAddressDto, UpdatePatientFamilyDto, CreatePatientAddressDto, CreatePatientFamilyDto, SetNationalIdDto } from './dto/patient-auth.dto';
import { encryptLegacyPid, hashNationalIdLegacy, maskRrn, decryptNationalIdTolerant } from '../../common/crypto/legacy-pid-crypto';

@ApiTags('Patient Profile')
@ApiBearerAuth()
@UseGuards(PatientAccountAuthGuard)
@Controller('api/v1/patient-auth/profile')
export class PatientProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auth: PatientAuthService,
  ) {}

  // ── 가족 계정(보호자↔피부양자 전환) ──

  @Get('family-accounts')
  @ApiOperation({ summary: '전환 가능한 가족 계정 목록(승인·미만료 피부양자)' })
  async getFamilyAccounts(@Req() req: PortalRequest) {
    return { data: await this.auth.getFamilyAccounts(req.patientAccountId!) };
  }

  @Post('family-accounts/:accountId/switch')
  @ApiOperation({ summary: '가족 계정 전환 — 피부양자 컨텍스트 토큰 발급(승인 링크만)' })
  async switchFamilyAccount(@Req() req: PortalRequest, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return { data: await this.auth.switchToFamilyAccount(req.patientAccountId!, accountId) };
  }

  // ── 주소 CRUD ──

  @Get('address')
  @ApiOperation({ summary: '주소 목록' })
  async getAddresses(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.prisma.patientAddress.findMany({ where: { patientId }, orderBy: { isPrimary: 'desc' } }) };
  }

  @Post('address')
  @ApiOperation({ summary: '주소 등록' })
  async createAddress(@Req() req: PortalRequest, @Body() dto: CreatePatientAddressDto) {
    const patientId = req.portalPatientId;
    if (dto.isPrimary) {
      await this.prisma.patientAddress.updateMany({ where: { patientId }, data: { isPrimary: false } });
    }
    return {
      data: await this.prisma.patientAddress.create({
        data: {
          patientId, type: dto.type ?? 'HOME',
          zipCode: dto.zipCode, roadAddress: dto.roadAddress, jibunAddress: dto.jibunAddress,
          detail: dto.detail, fullAddress: `${dto.roadAddress ?? ''} ${dto.detail ?? ''}`.trim(),
          isPrimary: dto.isPrimary ?? true,
        },
      }),
    };
  }

  @Put('address/:id')
  @ApiOperation({ summary: '주소 수정' })
  async updateAddress(@Param('id', ParseUUIDPipe) id: string, @Req() req: PortalRequest, @Body() dto: UpdatePatientAddressDto) {
    const patientId = req.portalPatientId;
    const addr = await this.prisma.patientAddress.findFirst({ where: { id, patientId } });
    if (!addr) throw new NotFoundException({ code: 'NOT_FOUND', message: '주소를 찾을 수 없습니다.' });
    return { data: await this.prisma.patientAddress.update({ where: { id }, data: dto }) };
  }

  @Delete('address/:id')
  @ApiOperation({ summary: '주소 삭제' })
  async deleteAddress(@Param('id', ParseUUIDPipe) id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    await this.prisma.patientAddress.deleteMany({ where: { id, patientId } });
    return { data: { deleted: true } };
  }

  // ── 가족 CRUD ──

  @Get('family')
  @ApiOperation({ summary: '가족 구성원 목록' })
  async getFamily(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.prisma.patientFamily.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }) };
  }

  @Post('family')
  @ApiOperation({ summary: '가족 등록' })
  async createFamily(@Req() req: PortalRequest, @Body() dto: CreatePatientFamilyDto) {
    const patientId = req.portalPatientId;
    return {
      data: await this.prisma.patientFamily.create({
        data: {
          patientId, relationship: dto.relationship, name: dto.name,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          phone: dto.phone, isEmergencyContact: dto.isEmergencyContact ?? false,
          medicalHistory: dto.medicalHistory,
        },
      }),
    };
  }

  @Put('family/:id')
  @ApiOperation({ summary: '가족 수정' })
  async updateFamily(@Param('id', ParseUUIDPipe) id: string, @Req() req: PortalRequest, @Body() dto: UpdatePatientFamilyDto) {
    const patientId = req.portalPatientId;
    const fam = await this.prisma.patientFamily.findFirst({ where: { id, patientId } });
    if (!fam) throw new NotFoundException({ code: 'NOT_FOUND', message: '가족 정보를 찾을 수 없습니다.' });
    const data: any = { ...dto };
    if (data.dateOfBirth) data.dateOfBirth = new Date(data.dateOfBirth);
    return { data: await this.prisma.patientFamily.update({ where: { id }, data }) };
  }

  @Delete('family/:id')
  @ApiOperation({ summary: '가족 삭제' })
  async deleteFamily(@Param('id', ParseUUIDPipe) id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    await this.prisma.patientFamily.deleteMany({ where: { id, patientId } });
    return { data: { deleted: true } };
  }

  // ── 주민등록번호 ──

  @Put('national-id')
  @ApiOperation({ summary: '주민등록번호 등록/변경 (비밀번호 재확인 필요)' })
  async setNationalId(@Req() req: PortalRequest, @Body() dto: SetNationalIdDto) {
    const patientId = req.portalPatientId;
    const clean = dto.nationalId.replace(/-/g, '');
    if (!this.encryption.validateNationalId(clean)) {
      throw new BadRequestException({ code: 'INVALID', message: '주민등록번호가 유효하지 않습니다.' });
    }
    // 비밀번호 재확인 — 계정 비밀번호 일치 시에만 주민번호 변경 허용 (2026-07 전체검토 C-5)
    const account = await this.prisma.patientAccount.findFirst({ where: { patientId }, select: { passwordHash: true } });
    if (!account || !(await bcrypt.compare(dto.password, account.passwordHash))) {
      throw new UnauthorizedException('비밀번호가 일치하지 않습니다.');
    }
    // 🔴 정본(PatientService)과 같은 **원시 hex 키**로 통일 + hash 동시 기록(파생 키로 쓰면 직원 차트가 복호 못 함)
    const encrypted = encryptLegacyPid(clean);
    await this.prisma.patient.update({
      where: { id: patientId },
      data: { nationalId: encrypted, nationalIdHash: hashNationalIdLegacy(clean) },
    });
    return { data: { masked: maskRrn(clean) } };
  }

  @Get('national-id/masked')
  @ApiOperation({ summary: '마스킹된 주민번호 조회' })
  async getMaskedNationalId(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { nationalId: true } });
    if (!patient?.nationalId) return { data: { masked: null } };
    // 🔴 혼재 컬럼(원시/파생) 모두 읽도록 관용 복호 후 마스킹 — 종전엔 파생 키로만 풀어 직원 등록 환자는 항상 전체 마스킹
    return { data: { masked: maskRrn(decryptNationalIdTolerant(patient.nationalId)) } };
  }
}