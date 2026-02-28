import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { DamlService } from '../daml/daml.service';

interface CreateGoogleUserDto {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  profilePicture?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private damlService: DamlService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: ['parties'],
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      relations: ['parties'],
    });
  }

  async findByPartyId(partyId: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { partyId },
    });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { googleId },
      relations: ['parties'],
    });
  }

  async findByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { auth0Id },
      relations: ['parties'],
    });
  }

  async findOrCreateAuth0User(dto: { auth0Id: string; email: string; name: string; rawToken?: string }): Promise<User> {
    // Look up by Auth0 ID first
    let user = await this.findByAuth0Id(dto.auth0Id);

    if (!user) {
      // Check if an existing user has this email (e.g. migrated from Google OAuth)
      if (dto.email) {
        user = await this.findByEmail(dto.email);
      }

      if (user) {
        // Link Auth0 account to existing user
        user.auth0Id = dto.auth0Id;
        user.lastLoginAt = new Date();
        user = await this.usersRepository.save(user);
        console.log(`[Auth0] Linked Auth0 account ${dto.auth0Id} to existing user ${user.email}`);
      } else {
        // Create new user
        const nameParts = dto.name.split(' ');
        user = this.usersRepository.create({
          auth0Id: dto.auth0Id,
          email: dto.email || `${dto.auth0Id}@auth0.local`,
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
          role: 'user',
          isActive: true,
          lastLoginAt: new Date(),
        });
        user = await this.usersRepository.save(user);
        console.log(`[Auth0] Created new user for ${dto.auth0Id} (${user.email})`);
      }
    } else {
      // Update last login
      user.lastLoginAt = new Date();
      user = await this.usersRepository.save(user);
    }

    // Auto-create Canton wallet if user doesn't have one yet
    if (!user.partyId) {
      try {
        const baseName = (user.firstName || user.email.split('@')[0] || 'user')
          .toLowerCase().replace(/[^a-z0-9]/g, '');
        const suffix = Math.random().toString(36).slice(2, 6);
        const damlUsername = `rhein-${baseName}-${suffix}`;
        console.log(`[Wallet] Auto-creating Canton wallet for ${user.email} as ${damlUsername}`);
        const partyId = await this.damlService.registerWithValidator(damlUsername, dto.rawToken);
        user.partyId = partyId;
        user = await this.usersRepository.save(user);
        console.log(`[Wallet] Created wallet for ${user.email}: ${partyId}`);
      } catch (err) {
        console.error(`[Wallet] Failed to create wallet for ${user.email}:`, err);
        // Don't fail login — user can link wallet later
      }
    }

    return user;
  }

  async findOrCreateGoogleUser(dto: CreateGoogleUserDto): Promise<User> {
    let user = await this.findByGoogleId(dto.googleId);

    if (!user) {
      user = await this.findByEmail(dto.email);
      if (user) {
        user.googleId = dto.googleId;
        user.profilePicture = dto.profilePicture || user.profilePicture;
        user.lastLoginAt = new Date();
        user = await this.usersRepository.save(user);
      } else {
        user = this.usersRepository.create({
          ...dto,
          role: 'user',
          isActive: true,
          lastLoginAt: new Date(),
        });
        user = await this.usersRepository.save(user);
      }
    } else {
      user.lastLoginAt = new Date();
      user = await this.usersRepository.save(user);
    }

    if (!user.partyId) {
      try {
        const baseName = (user.firstName || user.email.split('@')[0])
          .toLowerCase().replace(/[^a-z0-9]/g, '');
        const suffix = Math.random().toString(36).slice(2, 6);
        const damlUsername = `rhein-${baseName}-${suffix}`;
        const partyId = await this.damlService.registerWithValidator(damlUsername);
        user.partyId = partyId;
        user = await this.usersRepository.save(user);
      } catch (err) {
        console.error(`[Wallet] Failed to create wallet for ${user.email}:`, err);
      }
    }

    return user;
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      relations: ['parties'],
      order: { createdAt: 'DESC' },
    });
  }

  async update(id: string, updateData: Partial<User>): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    Object.assign(user, updateData);
    return this.usersRepository.save(user);
  }

  async makeAdmin(id: string): Promise<User> {
    return this.update(id, { role: 'admin' });
  }

  async deactivate(id: string): Promise<User> {
    return this.update(id, { isActive: false });
  }
}
