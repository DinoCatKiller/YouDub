import type {
	CollectionConfig,
	DeleteMutationFnParams,
	InferSchemaOutput,
	InsertMutationFnParams,
	LoadSubsetOptions,
	SyncConfig,
	UpdateMutationFnParams,
	UtilsRecord,
} from '@tanstack/solid-db';
import { fromTanDb } from 'agnostic-query/tanstack-db.js';
import type { Socket } from 'socket.io-client';
import type { StandardSchemaV1 } from './schema.ts';
import { emitAck } from './utils.ts';

interface SocketMessage<T> {
	type: 'insert' | 'update' | 'delete' | 'sync' | 'transaction';
	data?: T | T[];
	mutations?: Array<{
		type: 'insert' | 'update' | 'delete';
		data: T;
		id?: string;
	}>;
	transactionId?: string;
	id?: string;
}

interface SocketCollectionConfig<TSchema extends StandardSchemaV1>
	extends Omit<
		CollectionConfig<
			InferSchemaOutput<TSchema>,
			string | number,
			TSchema,
			SocketUtils
		>,
		'onInsert' | 'onUpdate' | 'onDelete' | 'sync' | 'schema'
	> {
	socket: Socket;
	id: string;
	schema: TSchema;

	reconnectInterval?: number;
}

export interface SocketCollectionQueryRequest<TQuery = unknown> {
	table: string;
	query?: TQuery;
	cursor?: unknown;
}

export interface SocketCollectionQueryResult<TItem> {
	rows: TItem[];
	nextCursor?: unknown;
	total?: number;
}

interface SocketUtils extends UtilsRecord {
	getConnectionState: () => 'connected' | 'disconnected' | 'connecting';
	reconnect: () => void;
}

type Handler = (message: SocketMessage<unknown>) => void;

type PendingEntry = {
	resolve: () => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
};

type TransactionPayload = {
	transactionId?: string;
	mutations?: {
		type: 'insert' | 'update' | 'delete';
		data: unknown;
		id?: string;
	}[];
};
type Entry = {
	handlers: Set<Handler>;
	pendingTransactions: Map<string, PendingEntry>;
	pendingInitialSync: boolean;
	connectionState: 'connected' | 'disconnected' | 'connecting';
	bound: boolean;
	refs: number;
	timeout?: ReturnType<typeof setTimeout>;
	boundHandlers?: {
		sync: (data: unknown[] | undefined) => void;
		// insert: (data: unknown) => void;
		// update: (data: unknown) => void;
		// delete: (data: unknown) => void;
		transaction: (payload: TransactionPayload) => void;
		connect: () => void;
		disconnect: () => void;
	};
};

const entries = new Map<string, Entry>();

function getEntry(id: string): Entry {
	let entry = entries.get(id);
	if (!entry) {
		entry = {
			handlers: new Set(),
			pendingTransactions: new Map(),
			pendingInitialSync: false,
			connectionState: 'disconnected',
			bound: false,
			refs: 0,
		};
		entries.set(id, entry);
	}

	return entry;
}

function bindSocket(socket: Socket, id: string, entry: Entry) {
	if (entry.bound) return;

	const emitToHandlers = (message: SocketMessage<unknown>) => {
		for (const handler of entry.handlers) {
			handler(message);
		}
	};

	const onSync = (data: unknown[] | undefined) => {
		emitToHandlers({ type: 'sync', data, id });
	};

	const onTransaction = (payload: TransactionPayload) => {
		emitToHandlers({
			type: 'transaction',
			transactionId: payload.transactionId,
			mutations: payload.mutations,
			id,
		});
	};

	socket.on('sync', onSync);
	socket.on('transaction', onTransaction);

	const onConnect = () => {
		entry.connectionState = 'connected';
		if (entry.pendingInitialSync && entry.refs > 0) {
			entry.pendingInitialSync = false;
			socket.emit('sync', { id });
		}
	};

	const onDisconnect = () => {
		entry.connectionState = 'disconnected';
	};

	socket.on('connect', onConnect);
	socket.on('disconnect', onDisconnect);

	entry.boundHandlers = {
		sync: onSync,
		transaction: onTransaction,
		connect: onConnect,
		disconnect: onDisconnect,
	};

	entry.bound = true;
}

function unbindSocket(socket: Socket, entry: Entry) {
	if (!entry.bound) return;

	if (entry.boundHandlers) {
		socket.off('sync', entry.boundHandlers.sync);
		socket.off('transaction', entry.boundHandlers.transaction);
		socket.off('connect', entry.boundHandlers.connect);
		socket.off('disconnect', entry.boundHandlers.disconnect);
	}
	entry.bound = false;
	entry.handlers.clear();
	entry.pendingTransactions.clear();
	entry.pendingInitialSync = false;
	entry.boundHandlers = undefined;
	entry.connectionState = socket.connected ? 'connected' : 'disconnected';
}

export function socketCollectionOptions<TSchema extends StandardSchemaV1>(
	config: SocketCollectionConfig<TSchema>,
): CollectionConfig<
	InferSchemaOutput<TSchema>,
	string | number,
	TSchema,
	SocketUtils
> & { schema: TSchema } {
	const syncMode = config.syncMode || 'on-demand';
	const socket = config.socket;
	const id = config.id!;
	const entry = getEntry(id);
	type TItem = InferSchemaOutput<TSchema>;

	const sync: SyncConfig<TItem>['sync'] = (params) => {
		const { begin, write, commit, markReady } = params;

		const handler: Handler = (message) => {
			if (message.id && message.id !== id) return;

			switch (message.type) {
				case 'sync':
					begin();
					if (Array.isArray(message.data)) {
						for (const item of message.data) {
							write({ type: 'insert', value: item as TItem });
						}
					}
					commit();
					markReady();
					break;

				case 'insert':
				case 'update':
				case 'delete':
					begin();
					write({ type: message.type, value: message.data as TItem });
					commit();
					break;

				case 'transaction':
					if (message.mutations) {
						begin();
						for (const mutation of message.mutations) {
							write({ type: mutation.type, value: mutation.data as TItem });
						}
						commit();
					}
					break;
			}
		};

		entry.handlers.add(handler);
		entry.refs += 1;
		entry.connectionState = socket.connected ? 'connected' : 'disconnected';
		bindSocket(socket, id, entry);

		if (syncMode === 'eager') {
			entry.pendingInitialSync = true;
			if (socket.connected) {
				entry.pendingInitialSync = false;
				socket.emit('sync', { id });
			} else {
				entry.connectionState = 'connecting';
			}
		} else {
			markReady();
		}
		console.log('Socket collection sync initialized for id:', id);

		async function loadSubset(opts: LoadSubsetOptions) {
			if (!socket.connected) {
				await new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => {
						reject(new Error('Socket connection timeout'));
					}, 15_000);
					socket.once('connect', () => {
						clearTimeout(timeout);
						resolve();
					});
				});
			}

			const querySchema = fromTanDb(opts);
			querySchema.table = id;

			try {
				const rows = await emitAck<TItem[]>(socket, 'loadSubset', querySchema);
				console.log('[socketCollection] loadSubset received rows:', rows);
				if (!Array.isArray(rows) || rows.length === 0) return;

				begin();
				for (const item of rows) {
					write({ type: 'insert', value: item });
				}
				commit();
			} catch (error) {
				console.error('[socketCollection] loadSubset failed:', error);
			}
		}

		function unloadSubset(opts: LoadSubsetOptions) {
			if (!socket.connected) return;

			const querySchema = fromTanDb(opts);
			querySchema.table = id;
			socket.emit('unloadSubset', querySchema);
		}

		function cleanup() {
			entry.handlers.delete(handler);
			entry.refs = Math.max(0, entry.refs - 1);

			if (entry.refs === 0) {
				if (entry.timeout) {
					clearTimeout(entry.timeout);
					entry.timeout = undefined;
				}
				unbindSocket(socket, entry);
			}
		}

		return syncMode === 'eager'
			? { cleanup }
			: { loadSubset, unloadSubset, cleanup };
	};

	async function sendTransaction(
		params:
			| InsertMutationFnParams<TItem>
			| UpdateMutationFnParams<TItem>
			| DeleteMutationFnParams<TItem>,
	): Promise<void> {
		if (!socket.connected) {
			throw new Error('Socket not connected');
		}

		const transactionId = crypto.randomUUID();
		const mutations = params.transaction.mutations.map((mutation) => ({
			type: mutation.type,
			id: mutation.key,
			data:
				mutation.type === 'delete'
					? undefined
					: mutation.type === 'update'
						? mutation.changes
						: mutation.modified,
		}));

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				entry.pendingTransactions.delete(transactionId);
				reject(new Error(`Transaction ${transactionId} timed out`));
			}, 10000);

			entry.pendingTransactions.set(transactionId, {
				resolve,
				reject,
				timeout,
			});

			socket.emit(
				'transaction',
				{
					id,
					transactionId,
					mutations,
				},
				(response: { ok: true } | { ok: false; error: string } | undefined) => {
					const pending = entry.pendingTransactions.get(transactionId);
					if (!pending) return;

					clearTimeout(pending.timeout);
					entry.pendingTransactions.delete(transactionId);

					if (response?.ok === false) {
						pending.reject(new Error(response.error));
						return;
					}

					pending.resolve();
				},
			);
		});
	}

	const onInsert = async (params: InsertMutationFnParams<TItem>) => {
		await sendTransaction(params);
	};

	const onUpdate = async (params: UpdateMutationFnParams<TItem>) => {
		await sendTransaction(params);
	};

	const onDelete = async (params: DeleteMutationFnParams<TItem>) => {
		await sendTransaction(params);
	};

	return {
		id: config.id,
		schema: config.schema,
		getKey: config.getKey,
		startSync: true,
		syncMode: config.syncMode ?? 'on-demand',
		sync: { sync },
		onInsert,
		onUpdate,
		onDelete,
		utils: {
			getConnectionState: () => entry.connectionState,
			reconnect: () => {
				if (!socket.connected) {
					socket.connect();
				}
			},
		},
	};
}
