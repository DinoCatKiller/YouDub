import { Badge } from '@repo/ui-solid/base/badge';
import { Store, useSelector } from '@tanstack/solid-store';
import { onCleanup, onMount } from 'solid-js';
import { socket } from '#/components/socket/ws.ts';

export const socketStore = new Store({
	status: 'disconnected',
});

const setSocketStatus = (
	status: 'connected' | 'disconnected' | 'connecting',
) => {
	socketStore.setState((prev) => ({
		...prev,
		status,
	}));
};

export const SocketMount = () => {
	console.log('SocketMount component rendered');
	onMount(() => {
		console.log('SocketMount mounted, connecting socket...');
		setSocketStatus('connecting');
		socket.connect();
		socket.on('connect', () => {
			console.log('Socket connected');
			setSocketStatus('connected');
		});
		socket.on('disconnect', () => {
			console.log('Socket disconnected');
			setSocketStatus('disconnected');
		});
		onCleanup(() => {
			socket.disconnect();
			console.log('Socket disconnected');
			setSocketStatus('disconnected');
		});
	});

	return null; // 这个组件不渲染任何 UI，只负责挂载和管理 WebSocket 连接
};

export const useSocketState = () => {
	const status = useSelector(socketStore, (state) => state.status); // 订阅状态变化
	return status;
};

// socket 指示器
export const SocketIndicator = () => {
	const status = useSocketState();
	return (
		<Badge class={status() === 'connected' ? 'bg-green-500' : 'bg-red-500'}>
			{status()}
		</Badge>
	);
};
