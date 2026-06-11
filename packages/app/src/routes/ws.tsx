import { Badge } from '@repo/ui-solid/base/badge';
import { Button } from '@repo/ui-solid/base/button';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@repo/ui-solid/base/card';
import { createFileRoute } from '@tanstack/solid-router';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import {
	SocketIndicator,
	useSocketState,
} from '#/components/socket/SocketMount.tsx';
import { socket } from '../components/socket/ws';

export const Route = createFileRoute('/ws')({
	component: WsTestPage,
});

function WsTestPage() {
	const [messages, setMessages] = createSignal<string[]>([]);
	const status = useSocketState();

	const [mlStatus, setMlStatus] = createSignal<any>(null);
	const [progress, setProgress] = createSignal<{
		message: string;
		percent: number;
	} | null>(null);

	onMount(() => {
		socket.on('connect', () => {
			addMessage('Connected to WebSocket server');
		});

		socket.on('ml:voxcpm:status', (statusData) => {
			setMlStatus(statusData);
			addMessage(
				`VoxCPM Status: ${statusData.isReady ? 'Ready' : 'Not Ready'}`,
			);
		});

		socket.on('ml:voxcpm:progress', (data: any) => {
			setProgress(data);
			addMessage(`[Progress] ${data.message} (${data.percent}%)`);
		});

		socket.on('disconnect', () => {
			addMessage('Disconnected from server');
		});
	});

	const prepareModel = () => {
		addMessage('Requesting model preparation...');
		socket.emit('ml:voxcpm:prepare', {}, (response: any) => {
			addMessage(`Server Ack: ${response.message} [${response.status}]`);
		});
	};

	const addMessage = (msg: string) => {
		setMessages((prev) => [msg, ...prev].slice(0, 50));
	};

	const subscribeToList = () => {
		addMessage('Subscribing to listTask...');
		socket.emit('subscribe', { topic: 'listTask' });
	};

	const unsubscribeFromList = () => {
		addMessage('Unsubscribing from listTask...');
		socket.emit('unsubscribe', { topic: 'listTask' });
	};

	return (
		<div class="p-8 space-y-6">
			<div class="flex items-center justify-between">
				<h1 class="text-2xl font-bold">
					WebSocket Socket.io Test{' '}
					<Button
						onClick={() => {
							socket.emit('test:event', { timestamp: Date.now() });
						}}
					>
						send msg
					</Button>
				</h1>

				<SocketIndicator />
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<Card>
					<CardHeader>
						<CardTitle>Controls</CardTitle>
					</CardHeader>
					<CardContent class="space-x-4">
						<Button
							onClick={prepareModel}
							disabled={status() !== 'connected' || mlStatus()?.isReady}
							class="h-9"
						>
							Prepare VoxCPM Model
						</Button>
						<Button
							onClick={subscribeToList}
							disabled={status() !== 'connected'}
						>
							Subscribe to List
						</Button>
						<Button
							onClick={unsubscribeFromList}
							variant="outline"
							disabled={status() !== 'connected'}
						>
							Unsubscribe
						</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Model Status</CardTitle>
					</CardHeader>
					<CardContent>
						<div class="space-y-4">
							<div class="flex justify-between items-center">
								<span>VoxCPM Ready:</span>
								<Badge
									class={mlStatus()?.isReady ? 'bg-green-500' : 'bg-yellow-500'}
								>
									{mlStatus()?.isReady ? 'READY' : 'NOT READY'}
								</Badge>
							</div>

							{progress() && (
								<div class="space-y-2">
									<div class="flex justify-between text-xs">
										<span>{progress()?.message}</span>
										<span>{progress()?.percent}%</span>
									</div>
									<div class="w-full bg-secondary h-2 rounded-full overflow-hidden">
										<div
											class="bg-primary h-full transition-all duration-300"
											style={{ width: `${progress()?.percent}%` }}
										/>
									</div>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Logs</CardTitle>
				</CardHeader>
				<CardContent>
					<div class="bg-black text-green-400 p-4 rounded h-64 overflow-y-auto font-mono text-sm">
						<For each={messages()}>{(msg) => <div>{`> ${msg}`}</div>}</For>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
