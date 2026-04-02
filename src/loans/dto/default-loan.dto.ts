import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DefaultLoanDto {
  @ApiPropertyOptional({ example: '2026-06-16', description: 'Override claim date in YYYY-MM-DD format (admin only)' })
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'claimDate must be in YYYY-MM-DD format' })
  claimDate?: string;
}
