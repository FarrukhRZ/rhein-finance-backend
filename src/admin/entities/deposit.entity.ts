import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Party } from './party.entity';

export type DepositStatus = 'pending' | 'approved' | 'completed' | 'failed';
export type AssetType = 'USDC' | 'CC';

@Entity('deposits')
export class Deposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  partyDbId: string;

  @ManyToOne(() => Party, (party) => party.deposits)
  @JoinColumn({ name: 'partyDbId' })
  party: Party;

  @Column()
  partyId: string; // DAML party ID for quick access

  @Column()
  partyName: string;

  @Column({
    type: 'enum',
    enum: ['USDC', 'CC'],
  })
  assetType: AssetType;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  externalReference: string; // External transaction ID/reference

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'completed', 'failed'],
    default: 'pending',
  })
  status: DepositStatus;

  @Column({ nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  approvedAt: Date;

  @Column({ nullable: true })
  approvedBy: string;

  @Column({ nullable: true })
  completedAt: Date;
}
