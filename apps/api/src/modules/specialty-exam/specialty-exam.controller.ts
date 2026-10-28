import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SpecialtyExamService } from './specialty-exam.service';
import {
  CreateEmergencyExamDto,
  CreateFamilyMedExamDto,
  CreatePediatricExamDto,
  CreateRehabExamDto,
} from './dto/specialty-exam.dto';

@ApiTags('Emergency Exam (응급의학 진료기록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/emergency')
export class EmergencyExamController {
  constructor(private readonly service: SpecialtyExamService) {}

  @Post('exams')
  @ApiOperation({ summary: '응급의학 진료기록 저장' })
  async create(@Body() body: CreateEmergencyExamDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createEmergency(body, userId) };
  }
}

@ApiTags('Family Medicine Exam (가정의학 진료기록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/family-medicine')
export class FamilyMedExamController {
  constructor(private readonly service: SpecialtyExamService) {}

  @Post('exams')
  @ApiOperation({ summary: '가정의학 진료기록 저장' })
  async create(@Body() body: CreateFamilyMedExamDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createFamilyMed(body, userId) };
  }
}

@ApiTags('Pediatrics Exam (소아청소년과 진료기록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/pediatrics')
export class PediatricExamController {
  constructor(private readonly service: SpecialtyExamService) {}

  @Post('exams')
  @ApiOperation({ summary: '소아청소년과 진료기록 저장' })
  async create(@Body() body: CreatePediatricExamDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createPediatric(body, userId) };
  }
}

@ApiTags('Rehab Exam (재활의학과 진료기록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/rehab')
export class RehabExamController {
  constructor(private readonly service: SpecialtyExamService) {}

  @Post('exams')
  @ApiOperation({ summary: '재활의학과 진료기록 저장' })
  async create(@Body() body: CreateRehabExamDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createRehab(body, userId) };
  }
}
