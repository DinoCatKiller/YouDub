import { downloadVoxCPM } from '../src/ml/voxcpm/download';

(async () => {
	try {
		await downloadVoxCPM((percent, message) => {
			console.log(`[download] ${percent}% - ${message}`);
		});
		console.log('[download] Completed successfully.');
		process.exit(0);
	} catch (err) {
		console.error('[download] Failed:', err);
		process.exit(1);
	}
})();
