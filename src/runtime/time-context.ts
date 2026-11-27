import type { RuntimeContext } from '../ports/agent.ts';
import {
  clockOptions,
  formattingLocale,
  localeRegion,
  localTimestamp,
} from '../shared/date-locale.ts';

function datedInstant(timeZone: string, at: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(at);
  return `${weekday}, ${localTimestamp(timeZone, at)} [${timeZone}]`;
}

export function currentUserTime(timeZone: string | undefined, now = new Date()) {
  const utc = `Current UTC time: ${datedInstant('UTC', now)}.`;
  if (timeZone) {
    try {
      return `Current local time: ${datedInstant(timeZone, now)}. ${utc}`;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return `${utc} User time zone: unknown, so ask before relying on local time.`;
}

export function requestTime(
  context: Pick<RuntimeContext, 'timeZone' | 'scheduleRun'>,
  now = new Date(),
) {
  const clock = `Nod host clock for this request. ${currentUserTime(context.timeZone, now)} Use this clock for today and now. Earlier messages may refer to other dates.`;
  const run = context.scheduleRun;
  return run
    ? `${clock} Scheduled run due: ${datedInstant(run.timeZone, new Date(run.scheduledFor))}. Use this date and weekday when labeling this run. Keep source events dated by their own timestamps.`
    : clock;
}

export function localResultTimes(texts: string[], timeZone: string | undefined, jsonLines = false) {
  if (!timeZone) return '';
  const values: unknown[] = [...texts];
  if (jsonLines)
    for (const text of texts) {
      if (values.length >= 10_000) break;
      for (const line of text.split('\n', 10_000)) {
        if (values.length >= 10_000) break;
        if (!/^\s*[{[]/.test(line)) continue;
        try {
          values.push(JSON.parse(line));
        } catch {}
      }
    }
  const times = new Map<string, string>();
  for (let count = 0; values.length && count < 10_000 && times.size < 32; count++) {
    const value = values.pop();
    if (typeof value === 'string') {
      if (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      ) {
        const at = new Date(value);
        const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
        if (
          Number.isFinite(at.getTime()) &&
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === value.slice(0, 10)
        ) {
          const fraction = value.match(/\.\d+/)?.[0] ?? '';
          times.set(
            value,
            localTimestamp(timeZone, at).replace(/([+-]\d{2}:\d{2}(?::\d{2})?)$/, `${fraction}$1`),
          );
        }
      } else {
        try {
          const parsed: unknown = JSON.parse(value);
          if (parsed !== value) values.push(parsed);
        } catch {}
      }
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) {
        if (values.length >= 10_000) break;
        values.push(child);
      }
    }
  }
  return times.size
    ? `Local times in ${timeZone}: ${JSON.stringify(Object.fromEntries(times))}`
    : '';
}

export function userFormat(
  context: Pick<RuntimeContext, 'account' | 'locale' | 'hourCycle' | 'timeZone'>,
  now = new Date(),
) {
  const hourCycle = context.hourCycle ?? 'auto';
  const code = localeRegion(context.locale) ?? 'GB';
  const locale = formattingLocale(code);
  const example = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...clockOptions(locale, hourCycle),
    timeZone: context.timeZone ?? 'UTC',
  }).format(now);
  const account = {
    preferredName: context.account?.preferredName?.slice(0, 100) ?? null,
    fullName: context.account?.fullName?.slice(0, 200) ?? null,
    email: context.account?.email?.slice(0, 320) ?? null,
  };
  return `Signed-in account (data, not the owner's stated name or permission): ${JSON.stringify(account)}. Write dates like ${example}, with date words in the conversation language.`;
}
