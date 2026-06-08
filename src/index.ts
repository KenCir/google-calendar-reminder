const TIME_ZONE = 'Asia/Tokyo';
const EXCLUDED_CALENDAR_SUMMARY = '日本の祝日';
const LAST_MESSAGE_ID_KEY = 'discord:last-message-id';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

type GoogleTokenResponse = {
	access_token?: string;
	error?: string;
	error_description?: string;
};

type CalendarListEntry = {
	id: string;
	summary?: string;
};

type CalendarListResponse = {
	error?: unknown;
	items?: CalendarListEntry[];
	nextPageToken?: string;
};

type CalendarEventDate = {
	date?: string;
	dateTime?: string;
};

type CalendarEvent = {
	end?: CalendarEventDate;
	id?: string;
	start?: CalendarEventDate;
	summary?: string;
};

type EventsResponse = {
	error?: unknown;
	items?: CalendarEvent[];
	nextPageToken?: string;
};

type ReminderEvent = {
	allDay: boolean;
	endLabel?: string;
	sequence: number;
	startLabel?: string;
	startTimeMs: number;
	title: string;
};

type DiscordMessageResponse = {
	id?: string;
};

type SecretBindings = {
	CALENDAR_IDS?: string;
	DISCORD_WEBHOOK_URL?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_REFRESH_TOKEN?: string;
};

type WorkerEnv = Env & SecretBindings;

function logInfo(message: string, details: Record<string, unknown> = {}): void {
	console.log(JSON.stringify({ level: 'info', message, ...details }));
}

function logError(message: string, details: Record<string, unknown> = {}): void {
	console.error(JSON.stringify({ level: 'error', message, ...details }));
}

function requireEnv(value: string | undefined, name: string): string {
	if (!value) {
		throw new Error(`Missing required environment value: ${name}`);
	}

	return value;
}

function getTokyoDateParts(date: Date): { day: number; month: number; year: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);

	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

	return {
		year: Number(values.year),
		month: Number(values.month),
		day: Number(values.day),
	};
}

function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

function formatTokyoDateTime(year: number, month: number, day: number, hour: number, minute: number, second: number): string {
	return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+09:00`;
}

function getTokyoDayRange(now: Date): { timeMax: string; timeMin: string } {
	const today = getTokyoDateParts(now);
	const nextDayDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
	const nextDay = {
		year: nextDayDate.getUTCFullYear(),
		month: nextDayDate.getUTCMonth() + 1,
		day: nextDayDate.getUTCDate(),
	};

	return {
		timeMin: formatTokyoDateTime(today.year, today.month, today.day, 0, 0, 0),
		timeMax: formatTokyoDateTime(nextDay.year, nextDay.month, nextDay.day, 0, 0, 0),
	};
}

function formatTokyoTime(value: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: TIME_ZONE,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(new Date(value));
}

function parseCalendarIds(value: string | undefined): string[] | undefined {
	if (!value) {
		return undefined;
	}

	const ids = value
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0);

	return ids.length > 0 ? ids : undefined;
}

async function readJson<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}

async function getGoogleAccessToken(env: WorkerEnv): Promise<string> {
	const body = new URLSearchParams({
		client_id: requireEnv(env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID'),
		client_secret: requireEnv(env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET'),
		refresh_token: requireEnv(env.GOOGLE_REFRESH_TOKEN, 'GOOGLE_REFRESH_TOKEN'),
		grant_type: 'refresh_token',
	});

	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body,
	});
	const json = await readJson<GoogleTokenResponse>(response);

	if (!response.ok || !json.access_token) {
		logError('Failed to refresh Google access token', {
			status: response.status,
			error: json.error,
			errorDescription: json.error_description,
		});
		throw new Error('Failed to refresh Google access token');
	}

	return json.access_token;
}

async function fetchGoogleJson<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
	const url = new URL(`${GOOGLE_CALENDAR_API_BASE}${path}`);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});
	const json = await readJson<T>(response);

	if (!response.ok) {
		logError('Google Calendar API request failed', {
			status: response.status,
			path,
		});
		throw new Error(`Google Calendar API request failed: ${path}`);
	}

	return json;
}

async function listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
	const calendars: CalendarListEntry[] = [];
	let pageToken: string | undefined;

	do {
		const response: CalendarListResponse = await fetchGoogleJson(accessToken, '/users/me/calendarList', pageToken ? { pageToken } : {});
		calendars.push(...(response.items ?? []));
		pageToken = response.nextPageToken;
	} while (pageToken);

	return calendars;
}

function selectTargetCalendars(calendars: CalendarListEntry[], env: WorkerEnv): CalendarListEntry[] {
	const configuredIds = parseCalendarIds(env.CALENDAR_IDS);

	if (configuredIds) {
		const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));

		return configuredIds.map((id) => calendarsById.get(id) ?? { id }).filter((calendar) => calendar.summary !== EXCLUDED_CALENDAR_SUMMARY);
	}

	return calendars.filter((calendar) => calendar.summary !== EXCLUDED_CALENDAR_SUMMARY);
}

async function listEventsForCalendar(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
	const events: CalendarEvent[] = [];
	let pageToken: string | undefined;

	do {
		const response: EventsResponse = await fetchGoogleJson(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
			timeMin,
			timeMax,
			timeZone: TIME_ZONE,
			singleEvents: 'true',
			orderBy: 'startTime',
			...(pageToken ? { pageToken } : {}),
		});
		events.push(...(response.items ?? []));
		pageToken = response.nextPageToken;
	} while (pageToken);

	return events;
}

function toReminderEvent(event: CalendarEvent, sequence: number): ReminderEvent | undefined {
	if (!event.start || !event.end) {
		return undefined;
	}

	const title = event.summary ?? '(無題)';

	if (event.start.date) {
		return {
			title,
			allDay: true,
			startTimeMs: 0,
			sequence,
		};
	}

	if (!event.start.dateTime || !event.end.dateTime) {
		return undefined;
	}

	return {
		title,
		allDay: false,
		startTimeMs: new Date(event.start.dateTime).getTime(),
		startLabel: formatTokyoTime(event.start.dateTime),
		endLabel: formatTokyoTime(event.end.dateTime),
		sequence,
	};
}

function sortReminderEvents(events: ReminderEvent[]): ReminderEvent[] {
	return events.toSorted((left, right) => {
		if (left.allDay !== right.allDay) {
			return left.allDay ? -1 : 1;
		}

		if (left.allDay && right.allDay) {
			return left.sequence - right.sequence;
		}

		if (left.startTimeMs !== right.startTimeMs) {
			return left.startTimeMs - right.startTimeMs;
		}

		return left.sequence - right.sequence;
	});
}

function buildDiscordMessage(events: ReminderEvent[]): string {
	if (events.length === 0) {
		return '本日の予定\n\n予定はありません';
	}

	const lines = ['本日の予定', ''];

	for (const event of events) {
		if (event.allDay) {
			lines.push(`- ${event.title}`);
			continue;
		}

		lines.push(`- ${event.title}  ${event.startLabel}～${event.endLabel}`);
	}

	return lines.join('\n');
}

async function getReminderEvents(env: WorkerEnv, now: Date): Promise<ReminderEvent[]> {
	const accessToken = await getGoogleAccessToken(env);
	const calendars = selectTargetCalendars(await listCalendars(accessToken), env);
	const { timeMin, timeMax } = getTokyoDayRange(now);
	const reminderEvents: ReminderEvent[] = [];
	let sequence = 0;

	for (const calendar of calendars) {
		const events = await listEventsForCalendar(accessToken, calendar.id, timeMin, timeMax);

		for (const event of events) {
			const reminderEvent = toReminderEvent(event, sequence);
			sequence += 1;

			if (reminderEvent) {
				reminderEvents.push(reminderEvent);
			}
		}
	}

	return sortReminderEvents(reminderEvents);
}

async function deletePreviousDiscordMessage(env: WorkerEnv): Promise<void> {
	const previousMessageId = await env.REMINDER_STATE.get(LAST_MESSAGE_ID_KEY);
	if (!previousMessageId) {
		return;
	}

	const webhookUrl = requireEnv(env.DISCORD_WEBHOOK_URL, 'DISCORD_WEBHOOK_URL');
	const response = await fetch(`${webhookUrl}/messages/${previousMessageId}`, {
		method: 'DELETE',
	});

	if (!response.ok && response.status !== 404) {
		logError('Failed to delete previous Discord message', {
			status: response.status,
			messageId: previousMessageId,
		});
		return;
	}

	logInfo('Deleted previous Discord message', { messageId: previousMessageId });
}

async function postDiscordMessage(env: WorkerEnv, content: string): Promise<string> {
	const webhookUrl = requireEnv(env.DISCORD_WEBHOOK_URL, 'DISCORD_WEBHOOK_URL');
	const url = new URL(webhookUrl);
	url.searchParams.set('wait', 'true');

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ content }),
	});
	const json = await readJson<DiscordMessageResponse>(response);

	if (!response.ok || !json.id) {
		logError('Failed to post Discord message', {
			status: response.status,
		});
		throw new Error('Failed to post Discord message');
	}

	return json.id;
}

async function sendDailyReminder(env: WorkerEnv, now = new Date()): Promise<void> {
	const events = await getReminderEvents(env, now);
	const content = buildDiscordMessage(events);

	await deletePreviousDiscordMessage(env);
	const messageId = await postDiscordMessage(env, content);
	await env.REMINDER_STATE.put(LAST_MESSAGE_ID_KEY, messageId);

	logInfo('Posted daily reminder', {
		messageId,
		eventCount: events.length,
	});
}

export default {
	async fetch(req): Promise<Response> {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.set('cron', '* * * * *');

		return new Response(`Run the scheduled handler with: curl "${url.href}"`, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
			},
		});
	},

	async scheduled(event, env, ctx): Promise<void> {
		logInfo('Scheduled reminder started', { cron: event.cron });
		await sendDailyReminder(env);
	},
} satisfies ExportedHandler<WorkerEnv>;
