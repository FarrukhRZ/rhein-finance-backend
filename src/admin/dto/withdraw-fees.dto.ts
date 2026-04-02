import { IsString, IsNumber, IsPositive, IsOptional, IsBoolean, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawFeesDto {
  @ApiProperty({ description: 'Recipient party ID', example: 'farrukh::1220abc...def' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/, {
    message: 'Invalid party ID format. Expected: name::1220[64 hex chars]',
  })
  recipientPartyId: string;

  @ApiProperty({ description: 'Amount of USDCx to withdraw', example: 10.5 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ description: 'Auto-accept on behalf of recipient if they are an app user', default: false })
  @IsBoolean()
  @IsOptional()
  autoAccept?: boolean;
}
