import type { Migration } from '../types';
import { initialMigration } from './0001_initial';

export const migrations: Migration[] = [initialMigration];
