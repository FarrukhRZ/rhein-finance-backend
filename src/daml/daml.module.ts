import { Module, Global } from '@nestjs/common';
import { DamlService } from './daml.service';
import { JwtUtilService } from './jwt-util.service';

// Re-export interfaces for convenience
export * from './interfaces';

@Global()
@Module({
  providers: [DamlService, JwtUtilService],
  exports: [DamlService, JwtUtilService],
})
export class DamlModule {}
