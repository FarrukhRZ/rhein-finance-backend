import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Deposit } from './deposit.entity';

@Entity('parties')
export class Party {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  partyId: string; // DAML party ID (e.g., "Alice::1220...")

  @Column()
  displayName: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @ManyToOne(() => User, (user) => user.parties)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ default: false })
  isIssuer: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string; // 'admin' or user ID

  @OneToMany(() => Deposit, (deposit) => deposit.party)
  deposits: Deposit[];
}
