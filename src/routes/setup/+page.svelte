<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import CopyBlock from './copy-block.svelte';
	import SessionForm from './session-form.svelte';
	import { Check as CheckIcon } from '@material-symbols-svg/svelte/rounded/icons/check';
	import { ArrowBack as ArrowBackIcon } from '@material-symbols-svg/svelte/rounded/icons/arrow-back';
	import { ArrowForward as ArrowForwardIcon } from '@material-symbols-svg/svelte/rounded/icons/arrow-forward';
	import { OpenInNew as OpenInNewIcon } from '@material-symbols-svg/svelte/rounded/icons/open-in-new';
	import { ProgressActivity as ProgressActivityIcon } from '@material-symbols-svg/svelte/rounded/icons/progress-activity';
	import { Celebration as CelebrationIcon } from '@material-symbols-svg/svelte/rounded/icons/celebration';

	let { data } = $props();

	const STORAGE = 'classroom:setup';
	const steps = [
		{ title: 'Paste the script', short: 'Script' },
		{ title: 'Deploy it', short: 'Deploy' },
		{ title: 'Connect', short: 'Connect' }
	];

	let step = $state(0);
	let key = $state('');
	let url = $state('');
	// Independent flags so each connect button spins/disables on its own
	// request; the two endpoints are independent and either may be retried
	// while the other is in flight.
	let scriptPending = $state(false);
	let sessionPending = $state(false);
	let useSession = $state(false);
	let cookie = $state('');
	let scriptError = $state<{ code: string; message: string } | null>(null);
	let sessionError = $state<{ code: string; message: string } | null>(null);
	let result = $state<
		| { ok: true; kind: 'script'; name?: string; email?: string; courseCount: number }
		| { ok: true; kind: 'session'; email?: string }
		| null
	>(null);
	let done = $state(false);

	function makeKey() {
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
			if (saved?.key) {
				key = saved.key;
				step = Math.min(saved.step ?? 0, steps.length - 1);
				url = saved.url ?? '';
			}
		} catch {}
		if (!key) key = makeKey();
	});

	$effect(() => {
		if (!key) return;
		try {
			localStorage.setItem(STORAGE, JSON.stringify({ key, step, url }));
		} catch {}
	});

	const codeSource = $derived(
		data.appsScriptSource.replace("const KEY = '';", `const KEY = '${key}';`)
	);

	const fixStep: Record<string, number> = { key: 0, manifest: 0, url: 1, access: 1 };

	async function postJson<T>(path: string, body: unknown): Promise<T> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return (await res.json()) as T;
	}

	function finishOk() {
		done = true;
		try {
			localStorage.removeItem(STORAGE);
		} catch {}
	}

	type ConfigResponse =
		| { ok: true; name?: string; email?: string; courseCount: number }
		| { ok: false; code: string; message: string };
	type SessionResponse =
		{ ok: true; email?: string } | { ok: false; code: string; message: string };

	type ConnectKind = 'script' | 'session';

	async function runConnect(kind: ConnectKind, fn: () => Promise<void>) {
		if (kind === 'script') scriptPending = true;
		else sessionPending = true;
		if (kind === 'script') scriptError = null;
		else sessionError = null;
		try {
			await fn();
		} catch (err) {
			const failure = { code: 'network', message: String(err) };
			if (kind === 'script') scriptError = failure;
			else sessionError = failure;
		} finally {
			if (kind === 'script') scriptPending = false;
			else sessionPending = false;
		}
	}

	async function connectScript() {
		await runConnect('script', async () => {
			const body = await postJson<ConfigResponse>('/api/config', { url, key });
			if (body.ok) {
				result = {
					ok: true,
					kind: 'script',
					name: body.name,
					email: body.email,
					courseCount: body.courseCount ?? 0
				};
				finishOk();
			} else
				scriptError = {
					code: body.code ?? 'unknown',
					message: body.message ?? 'That connection did not work.'
				};
		});
	}

	async function connectSession() {
		await runConnect('session', async () => {
			const body = await postJson<SessionResponse>('/api/session', { cookie });
			if (body.ok) {
				result = { ok: true, kind: 'session', email: body.email };
				finishOk();
			} else
				sessionError = {
					code: body.code ?? 'unknown',
					message: body.message ?? 'That cookie did not work.'
				};
		});
	}
</script>

<div class="mx-auto flex min-h-svh w-full max-w-xl flex-col px-4 py-10 sm:px-6">
	<div class="mb-8">
		<h1 class="text-headline-md text-balance text-on-surface">
			{done ? 'You’re connected' : 'Connect your Google Classroom'}
		</h1>
		<p class="mt-2 max-w-[60ch] text-body-lg text-pretty text-on-surface-variant">
			{#if done}
				Your first sync is running in the background. It takes a minute or two.
			{:else}
				Estimated time: 6 minutes
			{/if}
		</p>
		{#if data.configured && !done}
			<p
				class="mt-3 rounded-md bg-warning-container px-4 py-3 text-body-md text-on-warning-container"
			>
				Already connected. Finishing this replaces the current connection.
				<a href="/settings" class="ml-1 font-medium underline underline-offset-2"
					>Back to settings</a
				>
			</p>
		{/if}
	</div>

	{#if !done}
		<ol class="mb-6 flex items-center gap-2 text-label-lg">
			{#each steps as s, i (i)}
				{@const state = i < step ? 'done' : i === step ? 'current' : 'todo'}
				<li class="flex items-center gap-2">
					<button
						type="button"
						class={`flex h-8 items-center gap-2 rounded-full pr-3 pl-1 transition-colors ${
							state === 'current'
								? 'bg-secondary-container text-on-secondary-container'
								: state === 'done'
									? 'text-on-surface hover:bg-surface-container-high'
									: 'text-on-surface-variant'
						}`}
						disabled={state === 'todo'}
						onclick={() => (step = i)}
					>
						<span
							class={`flex size-6 items-center justify-center rounded-full text-label-md tabular-nums ${
								state === 'current'
									? 'bg-primary text-on-primary'
									: state === 'done'
										? 'bg-success text-on-success'
										: 'bg-surface-container-highest'
							}`}
						>
							{#if state === 'done'}<CheckIcon class="size-3" />{:else}{i + 1}{/if}
						</span>
						{s.short}
					</button>
					{#if i < steps.length - 1}<span class="h-px w-6 bg-outline-variant"></span>{/if}
				</li>
			{/each}
		</ol>
	{/if}

	<div class="rounded-3xl bg-surface-container-low p-6 sm:p-8">
		{#if done && result?.ok}
			<div class="flex flex-col items-center py-6 text-center">
				<span
					class="flex size-16 items-center justify-center rounded-[40%] bg-success-container text-on-success-container"
				>
					<CelebrationIcon class="size-6" />
				</span>
				<p class="mt-4 text-title-md">
					{result.kind === 'script' ? (result.name ?? 'Connected') : 'Connected'}
				</p>
				{#if result.email}<p class="text-body-md text-on-surface-variant">{result.email}</p>{/if}
				<p class="mt-3 text-body-md text-on-surface-variant">
					{#if result.kind === 'session'}
						Your courses are syncing now — this page updates as they arrive.
					{:else}
						Syncing {result.courseCount} active {result.courseCount === 1 ? 'course' : 'courses'}.
					{/if}
				</p>
				<Button class="mt-6" onclick={() => (window.location.href = '/')}>
					Open Classroom<ArrowForwardIcon data-icon="inline-end" />
				</Button>
			</div>
		{:else if step === 0}
			<h2 class="text-title-lg">{steps[0].title}</h2>
			<ol class="mt-4 space-y-4 text-body-md">
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>1</span
					>
					<div>
						Open
						<a
							href="https://script.google.com/home/projects/create"
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
							>script.google.com<OpenInNewIcon class="size-3" /></a
						>
						with your school account. It creates a new project for you.
					</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>2</span
					>
					<div>
						Click the gear <span class="text-on-surface-variant">(Project settings)</span> and tick
						<strong>Show “appsscript.json” manifest file in editor</strong>.
					</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>3</span
					>
					<div class="min-w-0 flex-1 space-y-2">
						<p>
							Back in the editor, replace everything in <code
								class="rounded bg-surface-container-high px-1 py-0.5 text-body-sm">Code.gs</code
							> with this:
						</p>
						<CopyBlock name="Code.gs" source={codeSource} />
					</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>4</span
					>
					<div class="min-w-0 flex-1 space-y-2">
						<p>
							Then replace everything in <code
								class="rounded bg-surface-container-high px-1 py-0.5 text-body-sm"
								>appsscript.json</code
							> with this:
						</p>
						<CopyBlock name="appsscript.json" source={data.manifestSource} />
					</div>
				</li>
			</ol>
		{:else if step === 1}
			<h2 class="text-title-lg">{steps[1].title}</h2>
			<p class="mt-1 text-body-md text-on-surface-variant">
				Deploying turns the script into a private URL this app can call.
			</p>
			<ol class="mt-4 space-y-4 text-body-md">
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>1</span
					>
					<div>Press <strong>Deploy</strong> (top right) → <strong>New deployment</strong>.</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>2</span
					>
					<div>Click the gear next to “Select type” and choose <strong>Web app</strong>.</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>3</span
					>
					<div>
						Set <strong>Execute as</strong> to <em>Me</em> and <strong>Who has access</strong> to
						<em>Anyone</em>.
						<span class="text-on-surface-variant">Not “Anyone with Google account”.</span>
					</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>4</span
					>
					<div>
						Press <strong>Deploy</strong>, then <strong>Authorize access</strong> and approve the
						permissions.
						<span class="text-on-surface-variant"
							>If Google says the app isn’t verified, click Advanced → Go to Untitled project.</span
						>
					</div>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-on-surface-variant tabular-nums"
						>5</span
					>
					<div>Copy the <strong>Web app URL</strong>. You’ll paste it in the next step.</div>
				</li>
			</ol>
		{:else}
			<h2 class="text-title-lg">{steps[2].title}</h2>
			<p class="mt-1 text-body-md text-on-surface-variant">
				Paste the web app URL. We’ll call the script once to check it answers as you.
			</p>
			<form
				class="mt-4 flex flex-col gap-2 sm:flex-row"
				onsubmit={(e) => {
					e.preventDefault();
					connectScript();
				}}
			>
				<Input
					bind:value={url}
					type="url"
					name="url"
					placeholder="https://script.google.com/macros/s/…/exec"
					autocomplete="off"
					spellcheck={false}
					aria-invalid={scriptError ? true : undefined}
					class="font-mono text-body-sm md:text-body-sm"
				/>
				<Button type="submit" disabled={scriptPending || !url} class="shrink-0">
					{#if scriptPending}<ProgressActivityIcon
							data-icon="inline-start"
							class="animate-spin"
						/>Checking{:else}Test and connect{/if}
				</Button>
			</form>
			{#if scriptError}
				{@const target = fixStep[scriptError.code]}
				<div
					class="mt-3 rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container"
				>
					<p>{scriptError.message}</p>
					{#if target !== undefined}
						<button
							type="button"
							class="mt-1 text-label-lg underline underline-offset-2"
							onclick={() => (step = target)}
						>
							Go back to step {target + 1}
						</button>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	{#if !done}
		<div class="mt-4 flex items-center justify-between">
			<Button variant="ghost" size="sm" disabled={step === 0} onclick={() => step--}>
				<ArrowBackIcon data-icon="inline-start" />Back
			</Button>
			{#if step < steps.length - 1}
				<Button size="sm" onclick={() => step++}>
					{step === 0 ? 'I’ve pasted both' : 'I have the URL'}<ArrowForwardIcon
						data-icon="inline-end"
					/>
				</Button>
			{/if}
		</div>
		<div class="mt-4 rounded-xl bg-surface-container p-5 sm:p-6">
			<button
				type="button"
				class="text-label-lg underline underline-offset-2"
				onclick={() => (useSession = !useSession)}
			>
				{useSession
					? 'Back to the Apps Script setup'
					: 'No Apps Script on your school account? Use a Classroom session instead'}
			</button>
			{#if useSession}
				<SessionForm
					bind:cookie
					testing={sessionPending}
					error={sessionError?.message}
					onConnect={connectSession}
				/>
			{/if}
		</div>
	{/if}
</div>
