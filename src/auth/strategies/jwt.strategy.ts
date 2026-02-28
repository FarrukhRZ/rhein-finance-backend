import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    const auth0Domain = configService.get('AUTH0_DOMAIN');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${auth0Domain}/.well-known/jwks.json`,
      }),
      issuer: `https://${auth0Domain}/`,
      algorithms: ['RS256'],
    });
  }

  async validate(req: any, payload: any) {
    const auth0Id = payload.sub;
    if (!auth0Id) {
      throw new UnauthorizedException('Invalid token: missing sub claim');
    }

    // Extract the raw bearer token for forwarding to validator API
    const authHeader = req.headers?.authorization || '';
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    const user = await this.usersService.findOrCreateAuth0User({
      auth0Id,
      email: payload.email || payload[`https://${this.configService.get('AUTH0_DOMAIN')}/email`] || '',
      name: payload.name || payload.nickname || '',
      rawToken,
    });

    if (!user.isActive) {
      throw new UnauthorizedException('User is deactivated');
    }

    // Attach raw token so wallet endpoints can forward it to the validator API
    user.rawToken = rawToken;
    return user;
  }
}
