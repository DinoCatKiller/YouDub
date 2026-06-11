import { z } from 'zod';

export const appErrCode = {
	INTERNAL_ERROR: 'INTERNAL_ERROR',
	IO_ERROR: 'IO_ERROR',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
} as const;

export type AppErrCode = (typeof appErrCode)[keyof typeof appErrCode];

export class AppError<C extends AppErrCode> extends Error {
	constructor(
		public code: C,
		message: string,
		public details?: unknown,
	) {
		super(message);
		this.name = 'WsError';
	}

	toJSON(): {
		ok: false;
		error: { code: string; msg: string; details?: unknown };
	} {
		return {
			ok: false as const,
			error:
				this.details !== undefined
					? { code: this.code, msg: this.message, details: this.details }
					: { code: this.code, msg: this.message },
		};
	}
}

export type AppErr<C extends AppErrCode = AppErrCode, D = undefined> = {
	code: C;
	msg: string;
	details?: D;
};

export type RetErr<C extends AppErrCode = AppErrCode, D = undefined> = {
	ok: false;
	error: AppErr<C, D>;
};

export type Ret<
	T = undefined,
	C extends AppErrCode = AppErrCode,
	D = undefined,
> =
	| {
			ok: true;
			data: T;
	  }
	| RetErr<C, D>;

export const newErr = <C extends AppErrCode, D = undefined>(
	code: C,
	msg: string,
	details?: D,
): RetErr<C, D> => ({
	ok: false,
	error: details === undefined ? { code, msg } : { code, msg, details },
});

const getErrorMessage = (error: unknown) =>
	error instanceof Error
		? error.message
		: typeof error === 'string'
			? error
			: 'Unknown error';

type AckFn<I = undefined, T = undefined> = (input: I) => Promise<T> | T;

export const errorHandler = <I = undefined, T = undefined>(fn: AckFn<I, T>) => {
	return async (input: I, result: (ret: Ret<T>) => void) => {
		try {
			const data = await fn(input);
			result({ ok: true, data });
		} catch (error) {
			console.error('Error in WebSocket handler:', error);
			if (error instanceof AppError) {
				result(error.toJSON() as Ret<T>);
			} else if (error instanceof z.ZodError) {
				result(
					newErr(
						appErrCode.VALIDATION_ERROR,
						error.message,
						error.issues,
					) as unknown as Ret<T>,
				);
			} else {
				result(
					newErr(appErrCode.INTERNAL_ERROR, getErrorMessage(error)) as Ret<T>,
				);
			}
		}
	};
};
