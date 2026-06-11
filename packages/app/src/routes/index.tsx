import { client, getDeviceInfo } from '@repo/api/src/client';
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
import { useAppForm } from '@repo/ui-solid/form/useAppForm';
import { useLiveQuery } from '@tanstack/solid-db';
import { createQuery } from '@tanstack/solid-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router';
import { ChevronRight, Play, Upload } from 'lucide-solid';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { TasksHistory } from '#/components/pages/index/tasks.tsx';
import { createTask, tasksCollect, tasksQ } from '#/feat/tasks/sync.ts';
import type { LocalDirection, TaskSummary } from '../lib/api';
import { uploadLocalTask } from '../lib/api';

export const Route = createFileRoute('/')({
	component: Home,
	onError: (err) => {
		console.error('Error loading home route:', err);
	},
});

function Home() {
	const navigate = useNavigate();

	let fileInputRef!: HTMLInputElement;

	const form = useAppForm(() => ({
		defaultValues: {
			youtubeUrl: '',
			bilibiliUrl: '',
			localFile: null as File | null,
			localDirection: 'en-zh' as LocalDirection,
		},
		onSubmit: async ({ value, formApi }) => {
			const submittedUrl = value.youtubeUrl.trim() || value.bilibiliUrl.trim();
			if (!submittedUrl && !value.localFile) {
				throw new Error('请提供 YouTube/Bilibili 链接或选择本地视频文件');
			}
			const created = value.localFile
				? await uploadLocalTask(value.localFile, value.localDirection)
				: await createTask(submittedUrl);
			formApi.setFieldValue('youtubeUrl', '');
			formApi.setFieldValue('bilibiliUrl', '');
			formApi.setFieldValue('localFile', null);
			if (fileInputRef) fileInputRef.value = '';
			navigate({ to: '/tasks/$id', params: { id: created.id } });
		},
	}));

	const directionLabels = [
		{
			value: 'en-zh',
			label: '英 → 中',
		},
		{
			value: 'zh-en',
			label: '中 → 英',
		},
	];

	console.log('Home component rendered');

	return (
		<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
			<Card>
				<CardHeader>
					<CardTitle>创建任务</CardTitle>
				</CardHeader>
				<CardContent>
					<form.AppForm>
						<form.Form onSubmit={form.handleSubmit} class="space-y-4">
							<form.AppField
								name="youtubeUrl"
								children={(field) => (
									<field.InputField
										title="YouTube 链接"
										placeholder="https://www.youtube.com/watch?v=..."
									/>
								)}
							/>
							<form.AppField
								name="bilibiliUrl"
								children={(field) => (
									<field.InputField
										title="Bilibili 链接"
										placeholder="https://www.bilibili.com/video/BV..."
									/>
								)}
							/>

							<div class="grid gap-3 sm:grid-cols-[1fr_180px]">
								<form.AppField
									name="localFile"
									children={(field) => (
										<field.FileInputField
											title="本地视频"
											type="file"
											ref={fileInputRef!}
											accept="video/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.flv,.wmv"
										/>
									)}
								/>
								<form.AppField
									name="localDirection"
									children={(field) => (
										<field.SelectField
											title="翻译方向"
											options={directionLabels}
											class="h-8"
										/>
									)}
								/>
							</div>
							<div class="flex items-center justify-between gap-3">
								<div></div>
								<form.SubmitButton
									label="创建任务"
									icon={<Play class="size-4" />}
								/>
							</div>
						</form.Form>
					</form.AppForm>
				</CardContent>
			</Card>

			<TasksHistory />
		</div>
	);
}
