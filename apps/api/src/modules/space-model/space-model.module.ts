import { Module } from '@nestjs/common';
import { HisModeModule } from '../../common/his-mode/his-mode.module';
import { SpaceModelController } from './space-model.controller';
import { SpaceModelService } from './space-model.service';

/** 공간 도면 가져오기·기하·(P3) 길안내 — spatial-flow-vision-3d */
@Module({
  imports: [HisModeModule],
  controllers: [SpaceModelController],
  providers: [SpaceModelService],
  exports: [SpaceModelService],
})
export class SpaceModelModule {}
