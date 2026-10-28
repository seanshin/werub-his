import { Module } from '@nestjs/common';
import { NeurosurgeryController } from './neurosurgery.controller';
import { NeurosurgeryService } from './neurosurgery.service';

@Module({
  controllers: [NeurosurgeryController],
  providers: [NeurosurgeryService],
})
export class NeurosurgeryModule {}
