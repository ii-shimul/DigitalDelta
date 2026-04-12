import type { Migration } from '../types';
import { initialMigration } from './0001_initial';
import { authStateMigration } from './0002_auth_state';
import { securityAndSessionMigration } from './0003_security_session';

export const migrations: Migration[] = [
  initialMigration,
  authStateMigration,
  securityAndSessionMigration,
];
