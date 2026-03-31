import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('platform_config')
export class PlatformConfig {
  @PrimaryColumn()
  id: number; // always 1 (singleton row)

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0.0075 })
  feeRate: number; // origination fee as a decimal, e.g. 0.0075 = 0.75%

  @UpdateDateColumn()
  updatedAt: Date;
}
