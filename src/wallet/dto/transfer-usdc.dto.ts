import { IsString, IsNotEmpty, IsNumber, Min, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class TransferUsdcDto {
  @ApiProperty({
    example: 'bob::12200868e62eb044f47552f943d03545973cd87fa0662a613d534d43f11a281e23c0',
    description: 'Recipient Canton party ID',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/, {
    message: 'Invalid party ID format',
  })
  recipientPartyId: string;

  @ApiProperty({ example: 100, description: 'Amount of USDC to transfer' })
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount: number;
}
