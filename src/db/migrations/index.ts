import type { Migration } from '../types';
import { initialMigration } from './0001_initial';
import { authStateMigration } from './0002_auth_state';
import { securityAndSessionMigration } from './0003_security_session';
import { crdtConflictsMigration } from './0004_crdt_conflicts';
import { meshMigration } from './0005_mesh';
import { triageMigration } from './0006_triage';
import { podMigration } from './0007_pod';
import { fleetMigration } from './0008_fleet';

export const migrations: Migration[] = [
  initialMigration,
  authStateMigration,
  securityAndSessionMigration,
  crdtConflictsMigration,
  meshMigration,
  triageMigration,
  podMigration,
  fleetMigration,
];
