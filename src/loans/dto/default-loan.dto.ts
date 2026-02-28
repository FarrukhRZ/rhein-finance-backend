import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DefaultLoanDto {
  @ApiProperty({ example: 'Alice::1220xyz...', description: 'Lender party ID claiming default' })
  @IsString()
  @IsNotEmpty()
  partyId: string;

  @ApiPropertyOptional({ example: '2026-06-16', description: 'Override claim date (for testing)' })
  @IsString()
  @IsOptional()
  claimDate?: string;
}
