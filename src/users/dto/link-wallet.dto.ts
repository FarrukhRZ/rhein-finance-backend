import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkWalletDto {
  @ApiProperty({
    example: 'dave::12200868e62eb044f47552f943d03545973cd87fa0662a613d534d43f11a281e23c0',
    description: 'Canton party ID from your wallet (format: name::1220...)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]+::1220[a-f0-9]{64}$/, {
    message: 'Invalid party ID format. Expected: name::1220[64 hex chars]',
  })
  partyId: string;
}
