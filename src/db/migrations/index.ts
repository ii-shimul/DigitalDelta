import type { Migration } from '../types';
import { initialMigration } from './0001_initial';
import { authStateMigration } from './0002_auth_state';
import { meshStateMigration } from './0003_mesh_state';

export const migrations: Migration[] = [
	initialMigration,
	authStateMigration,
	meshStateMigration,
];
