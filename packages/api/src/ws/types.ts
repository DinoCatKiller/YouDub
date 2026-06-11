import type { QuerySchema } from 'agnostic-query';
import type { Ret } from '#/ws/errors.ts';
import type { TableName } from '#/ws/registry.ts';

export type TransactionMutation = {
	type: 'insert' | 'update' | 'delete';
	id?: string;
	data?: Record<string, unknown>;
};

export type TransactionPayload = {
	id: string;
	transactionId: string;
	mutations: TransactionMutation[];
};

export type TransactionAck =
	| { ok: true }
	| {
			ok: false;
			error: string;
	  };

export type LoadSubsetPayload = QuerySchema & {
	table: TableName;
};

export interface CollectClientToServerEvents {
	loadSubset: (
		payload: LoadSubsetPayload,
		callback: (res: Ret<Array<Record<string, unknown>>>) => void,
	) => void;
	unloadSubset: (payload: LoadSubsetPayload) => void;
	transaction: (
		payload: TransactionPayload,
		callback: (response: TransactionAck) => void,
	) => void;
}
export interface CollectServerToClientEvents {
	transaction: (payload: TransactionPayload) => void;
}
