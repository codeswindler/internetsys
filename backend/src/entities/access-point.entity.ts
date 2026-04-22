import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AccessPointProvider {
  MIKROTIK_ROUTEROS = 'mikrotik_routeros',
  UNIFI = 'unifi',
  OMADA = 'omada',
  GENERIC = 'generic',
}

@Entity('access_points')
export class AccessPoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: AccessPointProvider,
    default: AccessPointProvider.MIKROTIK_ROUTEROS,
  })
  provider: AccessPointProvider;

  @Column({ nullable: true })
  host: string | null;

  @Column({ default: 8728 })
  port: number;

  @Column({ nullable: true })
  apiUsername: string | null;

  @Column({ type: 'text', nullable: true })
  apiPasswordEncrypted: string | null;

  @Column({ default: false })
  isNated: boolean;

  @Column({ nullable: true })
  vpnIp: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isOnline: boolean;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ type: 'json', nullable: true })
  capabilities: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
