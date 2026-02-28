import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Party } from '../../admin/entities/party.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  googleId: string;

  @Column({ nullable: true, unique: true })
  auth0Id: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  profilePicture: string;

  @Column({ default: 'user' })
  role: string; // 'user', 'admin'

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastLoginAt: Date;

  // Primary DAML party ID for this user
  @Column({ nullable: true })
  partyId: string;

  // Relation to parties (a user can have multiple parties)
  @OneToMany(() => Party, (party) => party.user)
  parties: Party[];

  // Transient: the user's raw Auth0 bearer token (not persisted to DB)
  // Set by JWT strategy for forwarding to validator wallet API
  rawToken?: string;
}
