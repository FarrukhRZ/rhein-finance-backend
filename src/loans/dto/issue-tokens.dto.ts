import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IssueTokensDto {
  @ApiProperty({ example: 'Alice::1220abc...', description: 'DAML party ID' })
  @IsString()
  @IsNotEmpty()
  partyId: string;
}
