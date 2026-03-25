import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package } from '../entities/package.entity';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private packageRepo: Repository<Package>,
  ) {}

  async create(createDto: Partial<Package>): Promise<Package> {
    const pkg = this.packageRepo.create(createDto);
    return this.packageRepo.save(pkg);
  }

  async findAll(activeOnly = true): Promise<Package[]> {
    if (activeOnly) {
      return this.packageRepo.find({ where: { isActive: true } });
    }
    return this.packageRepo.find();
  }

  async findOne(id: string): Promise<Package> {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException(`Package ${id} not found`);
    return pkg;
  }

  async update(id: string, updateDto: Partial<Package>): Promise<Package> {
    const pkg = await this.findOne(id);
    Object.assign(pkg, updateDto);
    return this.packageRepo.save(pkg);
  }

  async remove(id: string): Promise<void> {
    const pkg = await this.findOne(id);
    await this.packageRepo.remove(pkg);
  }
}
