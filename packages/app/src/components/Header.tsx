import { SettingsDialog } from "#/components/settings-dialog.tsx";
import { Link } from "@tanstack/solid-router";

export const Header = () => {
  return 						<header class="flex flex-col gap-4 border-b border-[#00aeec]/25 pb-5 sm:flex-row sm:items-center sm:justify-between">
							<div class="mx-auto flex h-12 max-w-4xl items-center gap-4 px-4">
								<Link
									to="/"
									class="text-sm font-semibold hover:text-muted-foreground transition-colors"
									activeOptions={{ exact: true }}
								>
									YouDub
								</Link>
							</div>
              <SettingsDialog />
						</header>
}