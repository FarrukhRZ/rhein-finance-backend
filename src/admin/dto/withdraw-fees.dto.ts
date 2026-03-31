import { IsString, IsNumber, IsPositive, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawFeesDto {
  @ApiProperty({ description: 'Recipient party ID', example: 'farrukh::1220...' })
  @IsString()
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
