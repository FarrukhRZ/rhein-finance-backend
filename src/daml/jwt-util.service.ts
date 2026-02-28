import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtUtilService {
  getTemplateId(packageId: string, templateName: string): string {
    return `${packageId}:${templateName}`;
  }
}
