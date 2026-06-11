import { cn } from '@repo/shared/lib/utils';
import { type ComponentProps, splitProps } from 'solid-js';

export function Card(
	props: ComponentProps<'div'> & { size?: 'default' | 'sm' },
) {
	const [local, others] = splitProps(props, ['class', 'size']);
	return (
		<div
			{...others}
			data-slot="card"
			data-size={local.size || 'default'}
			class={cn(
				'ring-foreground/10 bg-card text-card-foreground gap-4 overflow-hidden rounded-sm py-4 text-sm  has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col',
				local.class,
			)}
		/>
	);
}

function CardHeader(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-header"
			class={cn(
				'gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3 group/card-header @container/card-header grid auto-rows-min items-start has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
				local.class,
			)}
			{...others}
		/>
	);
}

function CardTitle(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-title"
			class={cn(
				'text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
				local.class,
			)}
			{...others}
		/>
	);
}

function CardDescription(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-description"
			class={cn('text-muted-foreground text-sm', local.class)}
			{...others}
		/>
	);
}

function CardAction(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-action"
			class={cn(
				'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
				local.class,
			)}
			{...others}
		/>
	);
}

function CardContent(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-content"
			class={cn('px-4 group-data-[size=sm]/card:px-3', local.class)}
			{...others}
		/>
	);
}

function CardFooter(props: ComponentProps<'div'>) {
	const [local, others] = splitProps(props, ['class']);
	return (
		<div
			data-slot="card-footer"
			class={cn(
				'bg-muted/50 rounded-b-xl border-t p-4 group-data-[size=sm]/card:p-3 flex items-center',
				local.class,
			)}
			{...others}
		/>
	);
}

export {
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
};
