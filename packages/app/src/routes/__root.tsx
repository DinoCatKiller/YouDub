// import appCss from '@repo/shared/styles/index.css?url';

import { Devtools } from '@repo/ui-solid/app/devtools';
import { Toaster } from '@repo/ui-solid/base/sonner';
import { ThemeProvider, themeScript } from '@repo/ui-solid/theme';
import type { QueryClient } from '@tanstack/solid-query';
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
} from '@tanstack/solid-router';
import { type JSX, Suspense } from 'solid-js';
import { Header } from '#/components/Header.tsx';
import { SocketMount } from '#/components/socket/SocketMount.tsx';

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	head: () => ({
		// links: [
		// 	{
		// 		rel: 'stylesheet',
		// 		href: appCss,
		// 	},
		// ],
		scripts: [{ children: themeScript }],
	}),

	component: RootComponent,
});

function RootComponent() {
	return (
		<>
			<HeadContent />
			<div class="antialiased min-h-dvh flex flex-col">
				<Suspense>
					<SocketMount />
					<ThemeProvider>
						<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
							<Header />
							<main class="flex-1">
								<Outlet />
							</main>
						</div>
						<Toaster duration={1000 * 10} />
					</ThemeProvider>

					<Devtools />
				</Suspense>
			</div>
		</>
	);
}
