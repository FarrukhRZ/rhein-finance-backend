import { IsOptional, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class OnboardUserDto {
  @ApiPropertyOptional({ example: 100000, description: 'Initial USDC amount to issue (default: 100000)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  initialUsdcAmount?: number;
}
