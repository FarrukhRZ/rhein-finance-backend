import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RepayLoanDto {
  @ApiProperty({ example: 10500, description: 'Repayment amount (principal + interest)' })
  @IsNumber()
  @Type(() => Number)
  @IsNotEmpty()
  @Min(0.000001, { message: 'repaymentAmount must be a positive number' })
  repaymentAmount: number;
}
