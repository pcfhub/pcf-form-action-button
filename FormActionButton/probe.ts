/*
 * THROWAWAY — pcf-form-action-button 0.1.9, the probe for 0.2.0. It asks and
 * changes nothing the button does; it is deleted before 0.2.0 is built.
 *
 * In the console on the form, after a press or two:
 *
 *     await __formActionButtonProbe.env()                       P1–P3
 *     await __formActionButtonProbe.call('pcfhub_FabProbe', true, { Note: 'x', Record: '{record}' })   P4, P7
 *     __formActionButtonProbe.bind('cll_editor2')                E1–E3
 *     __formActionButtonProbe.mode = 'prevent' | 'busy' | 'plain'
 *     JSON.stringify(__formActionButtonProbe.log, null, 1)
 */

import { ActionFetch, callAction } from './lib/web-api-action/action';
import { organisationUrl } from './lib/web-api-action/clientUrl';
import { DefinitionsFetch, MetadataUtils, loadRecordKeys } from './lib/web-api-action/keys';

type AnyContext = ComponentFramework.Context<unknown>;

interface ProbeEntry {
    at: string;
    [key: string]: unknown;
}

interface Probe {
    log: ProbeEntry[];
    presses: ProbeEntry[];
    outputs: ProbeEntry[];
    mode: 'plain' | 'prevent' | 'busy';
    env(): Promise<unknown>;
    call(name: string, bound: boolean, parameters?: Record<string, unknown>): Promise<unknown>;
    bind(controlName: string): unknown;
}

const started = Date.now();
const latest = new Map<number, { context: AnyContext; pass: number; id: unknown }>();
let instances = 0;
let probe: Probe | undefined;

function at(): string {
    return `+${((Date.now() - started) / 1000).toFixed(1)}s`;
}

function infoOf(context: AnyContext): { entityTypeName?: unknown; entityId?: unknown } | undefined {
    return (context.mode as unknown as { contextInfo?: { entityTypeName?: unknown; entityId?: unknown } }).contextInfo;
}

function newest(): { instance: number; context: AnyContext } | null {
    const last = [...latest.keys()].pop();

    return last === undefined ? null : { instance: last, context: (latest.get(last) as { context: AnyContext }).context };
}

function attempt<T>(call: () => T): T | string {
    try {
        return call();
    } catch (error) {
        return `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
}

export function probeInit(): number {
    instances += 1;
    install().log.push({ at: at(), instance: instances, event: 'init' });

    return instances;
}

/** Passive: a line on the first view and on every change of the record id, per instance (P1). */
export function probeView(instance: number, context: AnyContext): void {
    const info = infoOf(context);
    const before = latest.get(instance);
    const pass = (before?.pass ?? 0) + 1;

    latest.set(instance, { context, pass, id: info?.entityId });

    if (!before || before.id !== info?.entityId) {
        install().log.push({
            at: at(), instance, pass, event: before ? 'id changed' : 'first view',
            entityTypeName: info?.entityTypeName, entityId: info?.entityId,
        });
    }
}

export function probeDestroy(instance: number): void {
    install().log.push({ at: at(), instance, event: 'destroy' });
}

function install(): Probe {
    if (probe) {
        return probe;
    }

    const made: Probe = {
        log: [],
        presses: [],
        outputs: [],
        mode: 'plain',

        async env() {
            const found = newest();

            if (found === null) {
                return 'no instance has rendered';
            }

            const { context } = found;
            const info = infoOf(context);
            const page = (context as unknown as { page?: { getClientUrl?: () => unknown } }).page;
            const utils = (context as unknown as { utils?: MetadataUtils }).utils;
            const raw = utils as unknown as { getEntityMetadata?: (n: string) => Promise<Record<string, unknown>> } | undefined;
            const events = (context as unknown as { events?: Record<string, unknown> }).events;
            const table = typeof info?.entityTypeName === 'string' ? info.entityTypeName : 'account';
            const t0 = Date.now();
            let metadata: unknown = 'no getEntityMetadata';

            if (typeof raw?.getEntityMetadata === 'function') {
                metadata = await raw.getEntityMetadata(table).then(
                    (m) => ({ EntitySetName: m.EntitySetName, PrimaryIdAttribute: m.PrimaryIdAttribute, LogicalName: m.LogicalName, LogicalCollectionName: m.LogicalCollectionName, ms: Date.now() - t0 }),
                    (error: unknown) => `rejected: ${String(error)}`,
                );
            }

            return {
                instance: found.instance,
                instances: [...latest.keys()],
                contextInfo: { entityTypeName: info?.entityTypeName, entityId: info?.entityId },
                pageGetClientUrl: typeof page?.getClientUrl === 'function' ? attempt(() => (page.getClientUrl as () => unknown)()) : 'absent',
                organisationUrl: organisationUrl(context),
                metadata,
                keys: await loadRecordKeys(utils, organisationUrl(context), fetch as unknown as DefinitionsFetch, table),
                events: events ? Object.keys(events).map((k) => `${k}:${typeof events[k]}`) : 'absent',
                hasEntityPrivilege: typeof (context.utils as unknown as { hasEntityPrivilege?: unknown })?.hasEntityPrivilege,
            };
        },

        async call(name, bound, parameters = {}) {
            const found = newest();

            if (found === null) {
                return 'no instance has rendered';
            }

            const { context } = found;
            const info = infoOf(context);
            const base = organisationUrl(context);
            const table = typeof info?.entityTypeName === 'string' ? info.entityTypeName : 'account';
            const keys = await loadRecordKeys((context as unknown as { utils?: MetadataUtils }).utils, base, fetch as unknown as DefinitionsFetch, table);
            const id = typeof info?.entityId === 'string' ? info.entityId : '';

            if (base === null || keys === null) {
                return { base, keys };
            }

            const seen: { url?: string; body?: string; status?: number; ms?: number } = {};
            const t0 = Date.now();
            const recording: ActionFetch = (url, init) => {
                seen.url = url;
                seen.body = init.body;

                return (fetch as unknown as ActionFetch)(url, init).then((response) => {
                    seen.status = response.status;
                    seen.ms = Date.now() - t0;

                    return response;
                });
            };
            const outcome = await callAction(recording, base, { name, bound, parameters, result: null }, keys, id);
            const entry = { at: at(), event: 'call', name, bound, ...seen, outcome };

            made.log.push(entry);

            return entry;
        },

        bind(controlName) {
            const xrm = (globalThis as unknown as { Xrm?: { Page?: { getControl?: (n: string) => Record<string, unknown> | null } } }).Xrm;
            const control = xrm?.Page?.getControl?.(controlName);

            if (!control) {
                return `no control named ${controlName}`;
            }

            const result: Record<string, unknown> = {
                addEventHandler: typeof control.addEventHandler,
                addOnOutputChange: typeof control.addOnOutputChange,
                getOutputs: typeof control.getOutputs,
            };

            result.bound = attempt(() => {
                (control.addEventHandler as (name: string, fn: (payload: Record<string, unknown>) => void) => void)('onAction', (payload) => {
                    const shape = Object.keys(payload ?? {}).map((k) => `${k}:${typeof payload[k]}`);

                    made.presses.push({
                        at: at(), mode: made.mode, shape,
                        action: payload?.action, pressCount: payload?.pressCount, label: payload?.label,
                        entityTypeName: payload?.entityTypeName, entityId: payload?.entityId,
                    });

                    if (made.mode === 'prevent') {
                        (payload.preventDefault as () => void)();
                    } else if (made.mode === 'busy') {
                        (payload.setBusy as (m: string) => void)('Probe busy');
                        window.setTimeout(() => (payload.setResult as (r: unknown) => void)({ ok: true, message: 'Probe done' }), 1500);
                    }
                });

                return 'onAction';
            });

            result.listening = attempt(() => {
                (control.addOnOutputChange as (fn: () => void) => void)(() => {
                    made.outputs.push({ at: at(), outputs: attempt(() => (control.getOutputs as () => unknown)()) });
                });

                return 'addOnOutputChange';
            });

            made.log.push({ at: at(), event: 'bind', controlName, ...result });

            return result;
        },
    };

    probe = made;
    (globalThis as unknown as { __formActionButtonProbe?: Probe }).__formActionButtonProbe = made;

    return made;
}
