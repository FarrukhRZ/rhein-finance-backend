import { IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptOfferDto {
  @ApiProperty({
    description: 'The full loan offer object',
    example: {
      contractId: '00abc123...',
      payload: {
        initiator: 'Alice::1220...',
        offerType: 'BorrowerBid',
        loanAmount: '10000',
        collateralAmount: '5000',
        interestRate: '5.5',
        maturityDate: '2025-12-31'
      }
    }
  })
  @IsObject()
  @IsNotEmpty()
  offer: any;
}
