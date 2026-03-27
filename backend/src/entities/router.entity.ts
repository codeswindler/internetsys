import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Subscription } from './subscription.entity';

export enum RouterConnectionMode {
  HOTSPOT = 'hotspot',
  PPPOE = 'pppoe',
}

@Entity('routers')
export class Router {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: RouterConnectionMode,
    default: RouterConnectionMode.HOTSPOT,
  })
  connectionMode: RouterConnectionMode;

  @Column()
  host: string;

  @Column({ default: 8728 })
  port: number;

  @Column()
  apiUsername: string;

  @Column({ type: 'text' })
  apiPasswordEncrypted: string;

  @Column({ default: false })
  isNated: boolean;

  @Column({ nullable: true })
  vpnIp: string;

  @Column({ nullable: true })
  vpnUsername: string;

  @Column({ type: 'text', nullable: true })
  vpnPasswordEncrypted: string;

  @Column({ default: false })
  isOnline: boolean;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt: Date;

  @Column({ type: 'json', nullable: true })
  profiles: string[] | null;

  @OneToMany(() => Subscription, (subscription) => subscription.router)
  subscriptions: Subscription[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
