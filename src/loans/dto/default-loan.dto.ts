import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DefaultLoanDto {
  @ApiPropertyOptional({ example: '2026-06-16', description: 'Override claim date (for testing)' })
  @IsString()
  @IsOptional()
  claimDate?: string;
}
