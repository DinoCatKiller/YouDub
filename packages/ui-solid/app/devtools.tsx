// import { formDevtoolsPlugin } from "@tanstack/solid-form-devtools";
import { SolidQueryDevtoolsPanel } from "@tanstack/solid-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/solid-router-devtools";
import { lazy } from "solid-js";
import { isServer } from "solid-js/web";

export const Devtools =  !isServer ? lazy(() => 
  import('@tanstack/solid-devtools').then(
    ({ TanStackDevtools }) => ({default: () => <TanStackDevtools 					
			plugins={[
							{
								name: 'Tanstack Router',
								render: <TanStackRouterDevtoolsPanel />,
							},
							// storeDevtools,
							{
								name: 'Tanstack Query',
								render: <SolidQueryDevtoolsPanel />,
							},
							// formDevtoolsPlugin(),
						]} />})
          )
) : () => null;