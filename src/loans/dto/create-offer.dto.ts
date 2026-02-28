import { IsString, IsNotEmpty, IsEnum, Matches, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateOfferDto {
  @ApiProperty({ enum: ['BorrowerBid', 'LenderAsk'], example: 'BorrowerBid' })
  @IsEnum(['BorrowerBid', 'LenderAsk'])
  offerType: 'BorrowerBid' | 'LenderAsk';

  @ApiProperty({
    example: '10000',
    description: 'Loan amount in USDC (must be positive)'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d+)?$/, { message: 'loanAmount must be a valid positive number' })
  loanAmount: string;

  @ApiProperty({
    example: '1600',
    description: 'Collateral amount in CC (must be positive)'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d+)?$/, { message: 'collateralAmount must be a valid positive number' })
  collateralAmount: string;

  @ApiProperty({
    example: '0.055',
    description: 'Annual interest rate as decimal (e.g., 0.055 for 5.5%, must be between 0 and 1)'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0(\.\d+)?$|^1(\.0+)?$/, {
    message: 'interestRate must be a decimal between 0 and 1 (e.g., 0.055 for 5.5%)'
  })
  interestRate: string;

  @ApiProperty({
    example: '2025-12-31',
    description: 'Maturity date in YYYY-MM-DD format (must be in the future)'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'maturityDate must be in YYYY-MM-DD format' })
  maturityDate: string;
}
