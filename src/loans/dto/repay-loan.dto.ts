import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RepayLoanDto {
  @ApiProperty({ example: 'Bob::1220xyz...', description: 'Borrower party ID' })
  @IsString()
  @IsNotEmpty()
  partyId: string;

  @ApiProperty({ example: 10500, description: 'Repayment amount (principal + interest)' })
  @IsNumber()
  @Type(() => Number)
  @IsNotEmpty()
  repaymentAmount: number;
}
