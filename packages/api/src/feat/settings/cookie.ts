import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { to } from '@repo/shared/lib/utils/try';
import { YOUTUBE_COOKIE_PATH } from '@repo/config';

export const get_youtube_cookie = async () => {
	const [stats, err] = await to(stat(YOUTUBE_COOKIE_PATH));
	if (err)
		return {
			exists: false,
			size: 0,
		};

	return {
		exists: true,
		size: stats.size,
		updated_at: stats.mtimeMs,
	};
};
export type CookieInfo = Awaited<ReturnType<typeof get_youtube_cookie>>;

export const save_youtube_cookie = async (cookieString: string) => {
	const content = cookieString.trim();
	await mkdir(dirname(YOUTUBE_COOKIE_PATH), { recursive: true });
	if (content) {
		await writeFile(YOUTUBE_COOKIE_PATH, `${content}\n`, 'utf8');
	} else {
		try {
			await unlink(YOUTUBE_COOKIE_PATH);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}
	return await get_youtube_cookie();
};
