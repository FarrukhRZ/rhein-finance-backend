import { IsString, IsNotEmpty, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ApproveDepositDto {
  @ApiProperty({ example: 'Alice::1220abc...', description: 'DAML party ID' })
  @IsString()
  @IsNotEmpty()
  partyId: string;

  @ApiProperty({ enum: ['USDC', 'CC'], example: 'USDC', description: 'Asset type' })
  @IsEnum(['USDC', 'CC'])
  assetType: 'USDC' | 'CC';

  @ApiProperty({ example: 1000, description: 'Amount to deposit' })
  @IsNumber()
  @Type(() => Number)
  @Min(0.01, { message: 'Amount must be greater than 0' })
  amount: number;

  @ApiProperty({
    example: 'tx_abc123',
    description: 'External transaction reference (optional)',
    required: false
  })
  @IsOptional()
  @IsString()
  externalReference?: string;
}
