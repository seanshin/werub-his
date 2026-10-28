import { Controller, Get, Post, Put, Param, Body, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { OnboardingTokenGuard } from './guards/onboarding-token.guard';
import { ClaimDto, PasskeyVerifyDto, UpsertProfileDto, UploadDocumentDto, SignContractDto } from './dto/onboarding.dto';

const DOC_MAX = 10 * 1024 * 1024;
const DOC_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
const SENSITIVE_CATS = ['ID_CARD', 'BANKBOOK'];

// 입사예정자(계정 전) — OnboardingTokenGuard(토큰 기반). staff JwtAuthGuard 와 분리.
@ApiTags('Onboarding (입사예정자)')
@Throttle({ default: { limit: 20, ttl: 60000 } }) // 토큰 브루트포스 방어 (2026-07 전체검토 C-3)
@UseGuards(OnboardingTokenGuard)
@Controller('api/v1/onboarding')
export class OnboardingPublicController {
  constructor(private readonly svc: OnboardingService) {}

  @Get(':token')
  @ApiOperation({ summary: '온보딩 진입 — 상태·체크리스트' })
  view(@Req() req: any) {
    return { data: this.svc.publicView(req.invite) };
  }

  // 환영·회사소개 ──
  @Get(':token/welcome')
  @ApiOperation({ summary: '환영·회사소개 콘텐츠' })
  async welcome() {
    return { data: await this.svc.getWelcome() };
  }

  @Post(':token/welcome/ack')
  @ApiOperation({ summary: '환영·필수숙지 열람 확인' })
  async ackWelcome(@Req() req: any) {
    return { data: await this.svc.ackWelcome(req.invite.id) };
  }

  // 본인확인 → 임시계정 ──
  @Post(':token/claim')
  @ApiOperation({ summary: '본인확인(생년월일) → 임시계정 생성' })
  async claim(@Req() req: any, @Body() dto: ClaimDto) {
    return { data: await this.svc.claim(req.invite.id, dto.birthDate) };
  }

  // 생체등록(로그인정보 등록) — 기존 패스키 백엔드 재사용(§5.6)
  @Post(':token/passkey/register/options')
  @ApiOperation({ summary: '생체(패스키) 등록 옵션 발급' })
  async passkeyOptions(@Req() req: any) {
    return { data: await this.svc.passkeyRegisterOptions(req.invite.id) };
  }

  @Post(':token/passkey/register/verify')
  @ApiOperation({ summary: '생체(패스키) 등록 검증 → VERIFIED' })
  async passkeyVerify(@Req() req: any, @Body() dto: PasskeyVerifyDto) {
    return { data: await this.svc.passkeyRegisterVerify(req.invite.id, dto.response, dto.deviceName) };
  }

  // 개인정보(인적사항) ──
  @Get(':token/profile')
  @ApiOperation({ summary: '인적사항 조회' })
  async getProfile(@Req() req: any) {
    return { data: await this.svc.getProfile(req.invite.id) };
  }

  @Put(':token/profile')
  @ApiOperation({ summary: '인적사항 입력/저장(submit=true 시 제출 확정)' })
  async upsertProfile(@Req() req: any, @Body() dto: UpsertProfileDto) {
    return { data: await this.svc.upsertProfile(req.invite.id, dto as Record<string, unknown>) };
  }

  // 서류 업로드(온보딩 세션 전용) ──
  @Get(':token/documents')
  @ApiOperation({ summary: '제출 서류 목록' })
  async listDocuments(@Req() req: any) {
    return { data: await this.svc.listDocuments(req.invite.id) };
  }

  @Post(':token/documents')
  @ApiOperation({ summary: '서류 업로드' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // 버퍼 확보 → 서비스에서 암호화 저장(평문 미저장, G2)
      limits: { fileSize: DOC_MAX },
      fileFilter: (_req, file, cb) => {
        if (!DOC_TYPES.includes(file.mimetype)) return cb(new BadRequestException('이미지(PNG/JPG) 또는 PDF만 가능합니다.'), false);
        cb(null, true);
      },
    }),
  )
  async uploadDocument(@Req() req: any, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadDocumentDto) {
    if (!file) throw new BadRequestException('파일이 필요합니다.');
    const sensitive = SENSITIVE_CATS.includes(dto.category);
    return { data: await this.svc.saveEncryptedDocument(req.invite.id, dto.category, file.originalname, file.buffer, sensitive) };
  }

  // 전자계약 서명 ──
  @Post(':token/contract/sign')
  @ApiOperation({ summary: '근로/위촉 계약 전자서명 → CONTRACT_SIGNED' })
  async signContract(@Req() req: any, @Body() dto: SignContractDto) {
    return { data: await this.svc.signContract(req.invite.id, dto.templateId, dto.signatureImageKey) };
  }
}
