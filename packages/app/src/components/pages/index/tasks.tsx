import { Badge } from '@repo/ui-solid/base/badge';
import { Button } from '@repo/ui-solid/base/button';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@repo/ui-solid/base/card';
import { Input } from '@repo/ui-solid/base/input';
import { Label } from '@repo/ui-solid/base/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui-solid/base/select';
import { useLiveQuery } from '@tanstack/solid-db';
import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router';
import { ChevronRight, Play, Upload } from 'lucide-solid';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { tasksCollect, tasksQ } from '#/feat/tasks/sync.ts';

function statusBadgeClass(status?: string): string {
	switch (status) {
		case 'succeeded':
			return 'bg-blue-500/10 text-blue-600 border-blue-200';
		case 'failed':
			return 'bg-red-500/10 text-red-600 border-red-200';
		case 'running':
			return 'bg-pink-500/10 text-pink-600 border-pink-200';
		case 'queued':
			return 'bg-amber-500/10 text-amber-600 border-amber-200';
		default:
			return 'bg-muted text-muted-foreground';
	}
}

function statusLabel(status?: string): string {
	const map: Record<string, string> = {
		succeeded: '已完成',
		failed: '失败',
		running: '运行中',
		queued: '排队中',
	};
	return map[status ?? ''] ?? status ?? '未知';
}

function stageLabel(name?: string): string {
	const map: Record<string, string> = {
		download: '下载',
		separate: '人声分离',
		asr: '语音识别',
		asr_fix: '句子修正',
		translate: '翻译',
		split_audio: '切分音频',
		tts: '语音合成',
		merge_audio: '合成音频',
		merge_video: '合成视频',
	};
	return map[name ?? ''] ?? name ?? '';
}

function isActive(status: string) {
	return status === 'queued' || status === 'running';
}

function formatTime(value: string | null) {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}
function shortUrl(url: string) {
	return url.replace(/^https?:\/\/(www\.)?/, '');
}

// 任务历史
export function TasksHistory() {
	const tasks = useLiveQuery((q) => tasksQ(q));
	const isLoading = () => tasks.isLoading;
	console.log('Home component initialized, tasks signal created', tasks());
	createEffect(() => {
		console.log('Tasks updated:', tasks(), {
			isLoading: isLoading(),
		});
	});
	const queuedCount = () => tasks().filter((t) => isActive(t.status)).length;
	return (
		<Card>
			<CardHeader>
				<CardTitle>任务历史 ({tasks().length})</CardTitle>
			</CardHeader>
			<CardContent class="px-0">
				{isLoading() && <div>tasks Loading...</div>}
				<Show when={queuedCount() > 0}>
					<p class="text-xs text-muted-foreground">
						{queuedCount()} 个任务进行中
					</p>
				</Show>
				<Show when={queuedCount() === 0}>
					<span />
				</Show>
				{tasks().length === 0 && (
					<div class="px-6 py-12 text-center text-sm text-muted-foreground">
						暂无任务
					</div>
				)}
				<ul class="flex flex-col">
					{tasks().map((item) => (
						<li class="border-b border-border/60 last:border-b-0">
							<Link
								to="/tasks/$id"
								params={{ id: item.id }}
								class="flex w-full items-center gap-3 px-6 py-3 text-sm transition-colors hover:bg-muted/60"
							>
								<div class="min-w-0 flex-1">
									<p class="truncate text-left font-medium text-zinc-900 dark:text-zinc-100">
										{item.title || shortUrl(item.url)}
									</p>
									<div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
										<Badge class={statusBadgeClass(item.status)}>
											{statusLabel(item.status)}
										</Badge>
										<span>{formatTime(item.created_at)}</span>
										<Show when={isActive(item.status) && item.current_stage}>
											<span>· {stageLabel(item.current_stage!)}</span>
										</Show>
									</div>
								</div>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
							</Link>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
