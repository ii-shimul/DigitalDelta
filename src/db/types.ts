import type { DB, SQLBatchTuple } from '@op-engineering/op-sqlite';

export type DatabaseHandle = DB;

export type Migration = {
  id: number;
  name: string;
  statements: SQLBatchTuple[];
};
