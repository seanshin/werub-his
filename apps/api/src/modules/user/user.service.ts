import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { BCRYPT_SALT_ROUNDS, PROFESSION_ROLE, isClinicalProfession } from '@hospital-run/shared';
import { generateCompliantPassword, passwordPolicyViolations } from '../auth/password-policy';

/**
 * 🔴 정본 위반이면 **400**(사용자 입력 문제)으로 말한다 — 본인 변경 경로는 401 을 쓰지만
 *    거기는 현재 비밀번호 확인이 함께 있어 인증 맥락이다. 여기는 입력 검증이다.
 */
function assertPasswordPolicy(password: string, minLength?: number | null): void {
  const errors = passwordPolicyViolations(password, { minLength });
  if (errors.length > 0) throw new BadRequestException(`비밀번호 정책 위반: ${errors.join(', ')}`);
}

/** 직종이 역할과 맞는가 — 정본 shared PROFESSION_ROLE */
export function professionFitsRole(role: string, profession: string | null | undefined): boolean {
  if (!profession) return true;
  return isClinicalProfession(profession) && PROFESSION_ROLE[profession] === role;
}
function assertProfessionFitsRole(role: string, profession: string | null | undefined) {
  if (!professionFitsRole(role, profession)) {
    throw new BadRequestException({ code: 'PROFESSION_ROLE_MISMATCH', message: '이 역할에 둘 수 없는 직종입니다 — 의료기사 직종은 LAB_TECH, 간호사는 NURSE 역할에만 둘 수 있습니다.' });
  }
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  /** security.password.minLength(R9-④) — 강화 전용(하한 12 는 정본 상수). 조회 실패 = 하한 유지. */
  private async cfgMinLength(): Promise<number | null> {
    const v = await this.configRuntime?.get('security.password.minLength').catch(() => null);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, specialty: true, profession: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: [{ department: 'asc' }, { role: 'asc' }, { familyName: 'asc' }],
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, specialty: true, profession: true, isActive: true, lastLoginAt: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getSignature(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { signatureImage: true } });
    return { signatureImage: u?.signatureImage ?? null };
  }

  async saveSignature(userId: string, image: string | null) {
    if (image !== null) {
      if (typeof image !== 'string' || image.length > 3_000_000) throw new BadRequestException('서명 이미지가 너무 크거나 올바르지 않습니다');
      if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/.test(image)) throw new BadRequestException('유효하지 않은 서명 이미지 형식입니다 (PNG/JPEG만 허용)');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { signatureImage: image } });
    return { saved: true };
  }

  async create(dto: CreateUserDto & { department?: string; specialty?: string }) {
    assertProfessionFitsRole(dto.role, dto.profession ?? null);
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already exists');

    // 🔴 종전엔 DTO 의 길이 검사만 지나면 통과했다 — 선언된 기준(12자+복잡도)은
    //    **본인 변경 경로에만** 걸려 있었고, 생성·초기화가 그 아래로 새는 뒷문이었다.
    // 🔴 (2026-09-14) 비밀번호를 주지 않으면 서버가 정책을 통과하는 일회용 임의 비밀번호를 발급해 **이 응답에서 한 번만** 돌려준다
    //    (시드 계정과 같은 공용 기본값을 화면이 채우던 자리). 준 경우는 종전대로 정책 검사.
    //    `passwordChangedAt` 은 null — 기존 정본 `AuthService.isPasswordExpired` 가 "최초 설정 필요"로 판정한다(새 강제 규칙을 만들지 않는다).
    const minLength = await this.cfgMinLength();
    const issuedPassword = dto.password ? null : generateCompliantPassword(minLength);
    const password = dto.password ?? (issuedPassword as string);
    assertPasswordPolicy(password, minLength);
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        passwordChangedAt: null,
        familyName: dto.familyName,
        givenName: dto.givenName,
        role: dto.role,
        department: (dto as any).department,
        specialty: (dto as any).specialty,
        profession: dto.profession ?? null,
      },
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, specialty: true, profession: true, createdAt: true },
    });
    return issuedPassword ? { ...created, issuedPassword } : created;
  }

  async update(id: string, dto: UpdateUserDto & { password?: string; department?: string; specialty?: string; isActive?: boolean }) {
    await this.findById(id);
    const data: Prisma.UserUpdateInput & { password?: string } = { ...dto };
    // 직종은 역할과 맞아야 한다 — 역할만 바뀌어 기존 직종이 어긋나면 직종을 비운다(어긋난 채 남기면 화면이 사실과 다르게 말한다)
    const cur = await this.prisma.user.findUnique({ where: { id }, select: { role: true, profession: true } });
    const nextRole = (dto.role ?? cur?.role) as string;
    if (dto.profession !== undefined) assertProfessionFitsRole(nextRole, dto.profession);
    else if (dto.role && cur?.profession && !professionFitsRole(nextRole, cur.profession)) data.profession = null;
    if (data.password) {
      // 🔴 update 경로만 정책 검사 없이 해시하던 뒷문(2026-09-06 실측) — 같은 정본을 지난다
      assertPasswordPolicy(data.password as string, await this.cfgMinLength());
      data.passwordHash = await bcrypt.hash(data.password as string, BCRYPT_SALT_ROUNDS);
      delete data.password;
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, specialty: true, profession: true, isActive: true },
    });
  }

  async resetPassword(id: string, newPassword?: string | null) {
    await this.findById(id);
    // 🔴 관리자 초기화도 같은 정책이다 — 여기가 가장 낮았다(6자 → 8자 → 정본)
    // 🔴 (2026-09-14) 새 비밀번호를 주지 않으면 일회용 임의 비밀번호를 발급해 이 응답에서 한 번만 돌려준다.
    //    관리자가 정한 비밀번호는 본인이 바꾼 것이 아니다 — `passwordChangedAt` 을 null 로 되돌려 "최초 설정 필요"로 판정되게 한다.
    const minLength = await this.cfgMinLength();
    const issuedPassword = newPassword ? null : generateCompliantPassword(minLength);
    const password = newPassword || (issuedPassword as string);
    assertPasswordPolicy(password, minLength);
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    await this.prisma.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: null } });
    return issuedPassword ? { message: 'Password reset successfully', issuedPassword } : { message: 'Password reset successfully' };
  }

  async deactivate(id: string) {
    await this.findById(id);
    return this.prisma.user.update({ where: { id }, data: { isActive: false } });
  }

  async activate(id: string) {
    await this.findById(id);
    return this.prisma.user.update({ where: { id }, data: { isActive: true } });
  }

  async getOrgChart() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, familyName: true, givenName: true, role: true, department: true, specialty: true },
      orderBy: [{ department: 'asc' }, { role: 'asc' }],
    });

    const departments: Record<string, any[]> = {};
    for (const u of users) {
      const dept = u.department ?? '미배정';
      if (!departments[dept]) departments[dept] = [];
      departments[dept].push(u);
    }

    return Object.entries(departments).map(([name, members]) => ({
      department: name,
      members,
      count: members.length,
    }));
  }
  /**
   * 내 화면 표시 선호 — 기기 간 동기화(기획 medical-term-display-toggle.plan.md P2).
   * 행 없음 = 미설정(null) — 기본값을 만들어 넣지 않는다(미설정과 KO 선택은 다른 사실).
   */
  async getUiPreferences(userId: string) {
    const row = await this.prisma.userUiPreference.findUnique({ where: { userId } });
    return { termLang: row?.termLang ?? null, uiLocale: row?.uiLocale ?? null, updatedAt: row?.updatedAt ?? null };
  }

  /** 부분 갱신 — 보낸 필드만 바꾼다(안 보낸 필드를 null 로 지우지 않는다) */
  async setUiPreferences(userId: string, input: { termLang?: string; uiLocale?: string }) {
    if (input.termLang === undefined && input.uiLocale === undefined)
      throw new BadRequestException('변경할 표시 선호가 없습니다(termLang 또는 uiLocale).');
    const patch = {
      ...(input.termLang !== undefined ? { termLang: input.termLang } : {}),
      ...(input.uiLocale !== undefined ? { uiLocale: input.uiLocale } : {}),
    };
    const row = await this.prisma.userUiPreference.upsert({
      where: { userId },
      update: patch,
      create: { userId, ...patch },
    });
    return { termLang: row.termLang, uiLocale: row.uiLocale, updatedAt: row.updatedAt };
  }
}
