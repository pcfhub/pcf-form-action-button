/**
 * 0.2.0's decisions about the action — a decision module: the maker's four
 * properties in, what to call or the sentence saying why not out. Nothing here
 * touches the platform; `index.ts` fetches, calls and paints.
 *
 * What it rests on was measured on a form before it was written (SPEC.md,
 * *0.2.0, measured before it is written*): the record's id and table arrive in
 * `contextInfo`, `null` on a new record and on the same instance after the
 * first save (P1); a bound call from a field control answers 204 in 411 ms
 * (P4); and a bound Custom API cannot take a parameter named `Target`, because
 * the bound record already is one (P4b).
 */

import { TOKEN_ID, TOKEN_RECORD } from './lib/web-api-action/action';

/** An action's, a parameter's or a response property's name: what the Web API puts in a URL or a body. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** What the maker's properties say to call, or why they say nothing callable. */
export type ActionSetting =
    | { kind: 'none' }
    | { kind: 'invalid'; key: string; detail: string }
    | { kind: 'action'; name: string; bound: boolean; result: string | null };

/**
 * The action, from `actionName`, `actionBinding` and `resultProperty`. An empty
 * name is no action at all — 0.1.0's button exactly. A name the Web API could
 * never take is refused here, by name, rather than sent to come back a 404.
 * The name is kept as written: the server is case-sensitive about it.
 */
export function readActionSetting(name: unknown, binding: unknown, result: unknown): ActionSetting {
    const action = typeof name === 'string' ? name.trim() : '';

    if (action === '') {
        return { kind: 'none' };
    }

    if (!IDENTIFIER.test(action)) {
        return { kind: 'invalid', key: 'FormActionButton_BadName', detail: action };
    }

    const property = typeof result === 'string' ? result.trim() : '';

    if (property !== '' && !IDENTIFIER.test(property)) {
        return { kind: 'invalid', key: 'FormActionButton_BadResult', detail: property };
    }

    return { kind: 'action', name: action, bound: binding !== 'unbound', result: property === '' ? null : property };
}

/** The JSON itself starts with `{`; anything else is a web resource's name (`lib/config-source`). */
export function isInlineParameters(text: string): boolean {
    return text.startsWith('{');
}

export type ParametersRead = { ok: true; parameters: Record<string, unknown> } | { ok: false; reason: string };

/**
 * The body, as the maker wrote it: one JSON object, keyed by the action's
 * parameter names. `{id}` may sit anywhere in a string; `{record}` is only
 * ever a whole value, because it becomes an object — a reference to the record
 * — and half a reference inside a sentence is nothing the server can read.
 */
export function readParameters(text: string): ParametersRead {
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: 'they must be one JSON object, { "Name": value }' };
    }

    const parameters = value as Record<string, unknown>;
    const wrongKey = Object.keys(parameters).find((key) => !IDENTIFIER.test(key));

    if (wrongKey !== undefined) {
        return { ok: false, reason: `"${wrongKey}" is not a parameter name` };
    }

    const embedded = embeddedRecord(parameters);

    if (embedded !== null) {
        return { ok: false, reason: `"${TOKEN_RECORD}" must be a whole value — it becomes a reference to the record, not text (in "${embedded}")` };
    }

    return { ok: true, parameters };
}

/** The first string that carries `{record}` inside other text, or `null`. */
function embeddedRecord(value: unknown): string | null {
    if (typeof value === 'string') {
        return value !== TOKEN_RECORD && value.includes(TOKEN_RECORD) ? value : null;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = embeddedRecord(item);

            if (found !== null) {
                return found;
            }
        }

        return null;
    }

    if (value !== null && typeof value === 'object') {
        return embeddedRecord(Object.values(value));
    }

    return null;
}

/** Whether the parameters say `{id}` or `{record}` anywhere — an unbound call that still needs the record. */
export function mentionsRecord(text: string): boolean {
    return text.includes(TOKEN_ID) || text.includes(TOKEN_RECORD);
}

/**
 * Whether a call needs a saved record: a bound one always, an unbound one when
 * its parameters name the record. A new record has no id until its first save
 * (P1), so such a button waits for one.
 */
export function needsRecord(setting: ActionSetting, parametersText: string): boolean {
    return setting.kind === 'action' && (setting.bound || mentionsRecord(parametersText));
}

/**
 * The `actionStatus` output: the press it reports and how it went.
 * The count is in it so two presses with the same outcome are two different
 * values — `OnOutputChange` fires on a change, not on a write (E3).
 */
export function statusText(pressCount: number, ok: boolean): string {
    return `${pressCount}|${ok ? 'ok' : 'failed'}`;
}
