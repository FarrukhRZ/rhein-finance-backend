import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePartyDto {
  @ApiProperty({
    example: 'Alice',
    description: 'Party display name (alphanumeric and underscores only)'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'displayName must contain only letters, numbers, and underscores'
  })
  displayName: string;
}
