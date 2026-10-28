import { IInputs, IOutputs } from './generated/ManifestTypes';
import { ActionDef, ActionFetch, RecordKeys, Refusal, callAction } from './lib/web-api-action/action';
import { organisationUrl } from './lib/web-api-action/clientUrl';
import { DefinitionsFetch, MetadataUtils, loadRecordKeys } from './lib/web-api-action/keys';
import { SourceFetch, loadSource } from './lib/config-source/load';
import {
    ActionSetting,
    ParametersRead,
    isInlineParameters,
    needsRecord,
    readActionSetting,
    readParameters,
    statusText,
} from './press';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * How long an armed *inline* confirmation waits before reverting itself.
 *
 * A constant rather than an input property, and that is a decision rather than
 * an omission. It is a safety revert, not a feature: at 500ms it builds a button
 * a screen-reader or switch user cannot complete, and at 60s it leaves one armed
 * long after the user has moved on, so the next stray click is a confirmed
 * delete. Nothing in the properties pane lets a maker *test* the value they
 * typed, and a setting whose correct value cannot be discovered from the tool
 * that sets it gets set wrong.
 *
 * Only the inline fallback uses it. The platform's own dialog is modal and waits
 * as long as the user does.
 */
const CONFIRM_TIMEOUT_MS = 4000;

/**
 * How long the control waits for a busy handler to report back.
 *
 * Same family as the confirm revert and for the same reason: `setBusy()` and
 * `setResult()` are two calls in somebody else's web resource, and the pair that
 * is easy to write is the one where a `catch` path forgets the second. Without a
 * watchdog that leaves a permanently dead button on a form, recoverable only by
 * reloading the record, with nothing on screen saying why.
 *
 * Sixty seconds rather than something tidier: a `Xrm.WebApi` call against a busy
 * tenant can genuinely take tens of seconds, and a watchdog that fires while the
 * work is still running is worse than none — it tells the user the action failed
 * when it did not. This one is long enough that firing means something really
 * did go wrong, and it says so rather than claiming failure.
 */
const BUSY_TIMEOUT_MS = 60000;

/**
 * Fluent's own path data, at the 16px cut rather than the 20px one scaled down.
 * Fluent redraws each size instead of scaling, so a 20px glyph in a 16px box has
 * strokes a fifth too thin. Copied from @fluentui/react-icons.
 */
const ICON_PATHS = {
    send: 'M1.18 1.12a.5.5 0 0 1 .54-.07l13 6.5a.5.5 0 0 1 0 .9l-13 6.5a.5.5 0 0 1-.7-.6L2.98 8 1.02 1.65a.5.5 0 0 1 .16-.53M3.87 8.5l-1.55 5.03L13.38 8 2.32 2.47 3.87 7.5H9.5a.5.5 0 0 1 0 1z',
    delete: 'M7 3h2a1 1 0 0 0-2 0M6 3a2 2 0 1 1 4 0h4a.5.5 0 0 1 0 1h-.56l-1.2 8.84A2.5 2.5 0 0 1 9.74 15h-3.5a2.5 2.5 0 0 1-2.48-2.16L2.57 4H2a.5.5 0 0 1 0-1zm1 3.5a.5.5 0 0 0-1 0v5a.5.5 0 0 0 1 0zM9.5 6c.28 0 .5.22.5.5v5a.5.5 0 0 1-1 0v-5c0-.28.22-.5.5-.5m-4.74 6.7c.1.75.74 1.3 1.49 1.3h3.5a1.5 1.5 0 0 0 1.5-1.3L12.42 4H3.57z',
} as const;

/**
 * Which glyphs mirror themselves in a right-to-left app, read from the icons
 * package rather than guessed: `Send16Regular` carries `flipInRtl: true` and
 * `Delete16Regular` does not. An arrow points the way the text runs; a bin does
 * not have a handedness.
 */
const ICON_FLIPS_IN_RTL = { send: true, delete: false } as const;

type IconName = keyof typeof ICON_PATHS;

/**
 * The manifest's privilege names, mapped to the platform's numeric enum.
 *
 * `hasEntityPrivilege` takes numbers, not strings, and passing a string gets no
 * complaint from anything — the call simply answers about a privilege nobody
 * asked for. The names exist in the manifest so a maker picks from a list;
 * this table is where they become the thing the API wants.
 *
 * `PrivilegeType`: 0 None, 1 Create, 2 Read, 3 Write, 4 Delete, 5 Assign,
 * 6 Share, 7 Append, 8 AppendTo. Assign and Share are omitted deliberately —
 * neither describes an action a button on a form performs, and every value
 * offered is one this control then supports forever.
 */
const PRIVILEGE_TYPES: Record<string, number> = {
    create: 1,
    read: 2,
    write: 3,
    delete: 4,
    append: 7,
    appendTo: 8,
};

/**
 * `PrivilegeDepth.Basic`.
 *
 * Basic is the right question rather than the weakest one: Dataverse resolves a
 * role's depth upwards, so a user with Deep or Global write also answers `true`
 * to a Basic write. Asking for Global instead would refuse every user who is
 * merely allowed to edit their own team's records, which is most of them.
 */
const PRIVILEGE_DEPTH = 0;

/**
 * A logical name, and nothing else.
 *
 * `contextInfo.entityTypeName` is undocumented and untyped, so it is not a value
 * this control gets to assume the shape of before handing it to a platform API.
 */
const LOGICAL_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * What a form script receives from `addEventHandler("onAction", fn)`.
 *
 * The facts of the press, and three ways to answer. **Every callback is latched
 * to the press it was built for** — see `token` in the control — so a handler
 * that keeps the payload and calls back later is talking about a press that is
 * over, and the control ignores it rather than applying it to the current one.
 * That is not defensive tidying: an async handler naturally closes over its
 * payload, and a second press while the first is still running is one click.
 *
 * docs/model-driven.md is the maker-facing version of this contract, and the two
 * have to say the same thing.
 */
interface ActionPayload {
    /** `'press'`, or `'confirm'` when the user was asked and agreed. */
    action: 'press' | 'confirm';

    /**
     * The value `pressCount` will hold **if this press commits**. A handler that
     * calls `preventDefault()` leaves the output where it was, so the same
     * number arrives again on the next press. That is the honest reading: it is
     * the number of this press, not a count of handler invocations.
     */
    pressCount: number;

    /** The button's caption, so one handler can serve several buttons. */
    label: string;

    /** From `mode.contextInfo`; absent on a host that publishes none. */
    entityTypeName?: string;
    entityId?: string;

    /**
     * Suppress the output properties and the signal column for this press.
     *
     * **Synchronous only.** The handler runs inside the control's own click
     * path, and the outputs are written the moment it returns; a call from
     * inside a `.then()` arrives after the decision and is ignored with a
     * console warning rather than half-applied. The Client API says the same of
     * its own change events, which must not be asynchronous.
     */
    preventDefault(): void;

    /** Disable the button and say the work is running. */
    setBusy(message?: string): void;

    /** Clear busy and report. `ok: false` shows the message as a failure. */
    setResult(result: { ok: boolean; message?: string }): void;
}

/**
 * The events this control raises, named rather than left to `IEventBag`.
 *
 * `ComponentFramework.Context` declares `events` as **non-optional**, and the
 * generated `ManifestTypes.d.ts` says nothing about events at all, because
 * `manifestTypesGenerator` reads only `type-group`, `property` and `data-set`.
 * So `context.events.onAction(payload)` compiles whether or not the manifest
 * declares it, and would compile just as happily spelled `onActoin`. Neither the
 * types nor the manifest is evidence that the platform binds a callable to that
 * name at runtime.
 *
 * Declaring `onAction` optional here is how the guard in `raise()` survives a
 * reviewer who notices the platform types say it cannot be missing. See SPEC.md,
 * *Not verified*.
 */
interface FormActionButtonEvents {
    onAction?: (payload: ActionPayload) => void;
}

/**
 * The phases a press moves through.
 *
 * A press is a state machine rather than a handler, and single-flight falls out
 * of it rather than being defended: `asking` and `busy` simply do not accept a
 * click. A double press before a modal dialog paints is the ordinary way to get
 * two of everything, and it is not reachable from here.
 */
type Phase = 'idle' | 'armed' | 'asking' | 'busy';

/** How an action's call ended: what the button says, and what the outputs carry. */
interface Finish {
    ok: boolean;
    message: string;
    result: string;
}

/** Parameters that could not be had at all — a web resource missing or unreadable — say a whole sentence of their own. */
type ParametersLoad = ParametersRead | { ok: false; reason: string; whole: true };

/**
 * A button, for a model-driven form.
 *
 * **It binds a column because a form hosts a field component on one**, and it
 * does not write that column unless asked to. Its canvas-shaped sibling
 * `pcf-action-button` binds nothing, which is exactly why that one cannot go on
 * a form and this one can.
 *
 * **A press reaches a form script three ways, and all three ship.** The custom
 * `onAction` event, bound with `control.addEventHandler`; the output properties,
 * observed with `control.addOnOutputChange` and read with `control.getOutputs`;
 * and — only when `writeSignal` is on — the bound column, whose own `OnChange`
 * handler and business rules then see it. Each is missing on some host or in
 * some maker's setup, and none of them costs the others anything.
 *
 * **The event is raised before the outputs are written, and that ordering is the
 * one thing in here that is not obvious.** Its canvas sibling does the reverse,
 * so that a maker's Power Fx cannot take the outputs down with it. Here the
 * handler is allowed to *veto* the outputs, which it cannot do after they have
 * been written — so the raise goes first, inside a `try`, and a handler that
 * throws is logged and the outputs are written anyway. Both controls end up with
 * the same guarantee by opposite means: a broken handler never costs the maker
 * their other channel.
 *
 * **`pressCount` exists because a change event fires on a change, not on a
 * write.** Two consecutive confirmed presses both writing `lastAction:
 * "confirm"` are one `OnOutputChange` and one silence, and the maker sees a
 * button that works once.
 *
 * **Since 0.2.0 a press can also call a Dataverse action**, named in
 * `actionName`, after the event and the outputs — so a flow on *When an action
 * is performed*, or a plug-in, does the work with no form script. Measured on a
 * form before it was written (SPEC.md, *0.2.0, measured before it is
 * written*); the call is `lib/web-api-action`, shared with pcf-row-commands.
 */
export class FormActionButton implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    private button!: HTMLButtonElement;
    private caption!: HTMLSpanElement;
    private spinner!: HTMLSpanElement;
    private status!: HTMLParagraphElement;

    /** Built once in `init` and shown or hidden by class, never rebuilt. */
    private icons!: Record<IconName, Element>;

    /** The maker's glyph choice, which the busy spinner temporarily displaces. */
    private iconName: IconName | null = null;

    private notifyOutputChanged!: () => void;

    /*
     * Re-captured on every render, alongside `events` and `navigation`.
     *
     * A click handler, a timer and a promise continuation have no `context` of
     * their own, and holding the first pass's `resources` forever is the bug
     * this exists to avoid — the platform hands down a fresh context each pass
     * and the old one is not promised to keep working.
     */
    private resources!: ComponentFramework.Resources;
    private events: FormActionButtonEvents | undefined;
    private navigation: ComponentFramework.Navigation | undefined;

    /*
     * The outputs.
     *
     * **Both start at a non-nullable value and are only ever assigned one, and
     * that is load-bearing rather than tidy.** `refreshTypes` generates
     * `pressCount?: number` and `lastAction?: string`, so the moment either can
     * be `null`, `?? undefined` becomes the edit that makes `tsc` go quiet — and
     * `undefined` means *no change*, so the output stops being observable. That
     * is the bug pcf-star-rating shipped.
     *
     * Do not "tidy" `''` into `null` here.
     */
    private pressCount = 0;
    private lastAction = '';

    /**
     * The bound column's new value, or `undefined` for "never written".
     *
     * This is the one place in this repository where `undefined` from
     * `getOutputs()` is the intent rather than the bug: with `writeSignal` off
     * the control must leave the column exactly as it found it, and "no change"
     * is precisely what `undefined` means to the platform.
     */
    private signal: string | undefined;

    private phase: Phase = 'idle';
    private confirmTimer: number | undefined;
    private busyTimer: number | undefined;

    /**
     * Monotonic, and incremented on every raise **attempt** — including one a
     * handler vetoes, which `pressCount` deliberately does not count.
     *
     * Everything a payload can do is checked against this. It is a separate
     * number from `pressCount` for exactly that reason: latching on an output
     * the handler is allowed to suppress would make a vetoed press share a token
     * with the next one.
     */
    private token = 0;

    /** Set while a raise is on the stack, so `preventDefault` can refuse a late call. */
    private raising = 0;
    private prevented = false;

    /**
     * Flipped in `destroy()`.
     *
     * A handler that kept its payload across a form navigation is holding
     * callbacks that would otherwise write to detached elements, and a promise
     * continuation from a dialog opened on a form the user has left resolves
     * into a control that no longer exists.
     */
    private destroyed = false;

    /* What the click handler needs and cannot read from a context it lacks. */
    private hostInteractive = true;
    private confirmRequired = false;
    private labelText = '';
    private confirmTitleText = '';
    private confirmBodyText = '';
    private confirmButtonText = '';

    private writeSignal = false;
    private entityTypeName: string | undefined;
    private entityId: string | undefined;

    /*
     * 0.2.0: the action a press calls, read on every render. The parameters and
     * the table's address are loaded at the first press that needs them and
     * kept, so a form that is only looked at fetches nothing.
     */
    private actionSetting: ActionSetting = { kind: 'none' };
    private parametersText = '';
    private clientUrl: string | null = null;
    private metadataUtils: MetadataUtils | undefined;
    private parametersLoad: { key: string; read: Promise<ParametersLoad> } | null = null;
    private keysLoads = new Map<string, Promise<RecordKeys | null>>();

    /** Why the button is off for its action, as the sentence it says — or `null`. */
    private blocked: string | null = null;

    /** The sentence `blocked` last put in the status line, so a render repeats nothing. */
    private blockedShown: string | null = null;

    /*
     * The two 0.2.0 outputs. Strings from the start, for the reason
     * `pressCount` is a number from the start.
     */
    private actionStatus = '';
    private actionResult = '';

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.container = container;
        this.container.classList.add('FormActionButton');

        this.button = document.createElement('button');
        this.button.className = 'FormActionButton-button';
        /*
         * Explicitly `button`. The default is `submit`, and a code component
         * lives inside the form's own markup — where a button that was only
         * meant to raise an event submits something.
         */
        this.button.type = 'button';

        this.icons = {
            send: createIcon('send'),
            delete: createIcon('delete'),
        };

        /*
         * A CSS-only spinner, hidden by attribute rather than rebuilt. It is
         * `aria-hidden`: the live region already says the work is running, and a
         * spinner that also announced would say it twice.
         */
        this.spinner = document.createElement('span');
        this.spinner.className = 'FormActionButton-spinner';
        this.spinner.setAttribute('aria-hidden', 'true');
        this.spinner.setAttribute('hidden', 'hidden');

        this.caption = document.createElement('span');
        this.caption.className = 'FormActionButton-caption';

        /*
         * Everything is appended once and shown by attribute. Rebuilding in
         * `updateView` would rebuild constantly — and both the confirmation and
         * the busy state run outside `updateView`, so anything the render
         * touches is something they can lose.
         */
        this.button.append(this.icons.send, this.icons.delete, this.spinner, this.caption);

        this.button.addEventListener('click', this.onClick);
        this.button.addEventListener('blur', this.onBlur);
        this.button.addEventListener('keydown', this.onKeyDown);

        this.status = document.createElement('p');
        this.status.className = 'FormActionButton-status';
        /*
         * Polite, and the region is the *second* channel rather than the first.
         * Arming swaps the button's own accessible name, which a screen reader
         * announces on its own because focus is on the button. `assertive` would
         * interrupt the announcement this is here to back up.
         */
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');

        this.container.append(this.button, this.status);

        this.render(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.render(context);
    }

    /**
     * Every output, every time, and no `??` anywhere in it.
     *
     * `undefined` means "no change" to the platform, so a nullish-coalescing
     * default on `pressCount` or `lastAction` would silently stop a press being
     * observable. `signal` is the deliberate exception and is omitted from the
     * object entirely rather than set to `undefined`, because the two mean the
     * same thing to the platform and only one of them reads like a decision.
     */
    public getOutputs(): IOutputs {
        const outputs: IOutputs = {
            pressCount: this.pressCount,
            lastAction: this.lastAction,
            actionStatus: this.actionStatus,
            actionResult: this.actionResult,
        };

        if (this.signal !== undefined) {
            outputs.signal = this.signal;
        }

        return outputs;
    }

    public destroy(): void {
        /*
         * The latch first, then the timers.
         *
         * A control removed from a form mid-confirmation otherwise leaves a
         * `setTimeout` holding a reference to a detached element — the platform
         * does not clean that up, because from its side the control simply
         * stopped being. The latch covers the other half: a handler that is
         * still awaiting something holds three callbacks into this object, and
         * nothing stops it calling them.
         */
        this.destroyed = true;
        this.clearConfirmTimer();
        this.clearBusyTimer();

        this.button.removeEventListener('click', this.onClick);
        this.button.removeEventListener('blur', this.onBlur);
        this.button.removeEventListener('keydown', this.onKeyDown);
    }

    private render(context: ComponentFramework.Context<IInputs>): void {
        this.resources = context.resources;
        this.events = (context as ComponentFramework.Context<IInputs, FormActionButtonEvents>).events;
        this.navigation = context.navigation;

        this.applyTheme(context);
        this.readIdentity(context);
        this.readAction(context);

        const allowed = this.hasPrivilege(context);
        const hidden =
            !context.mode.isVisible
            || (!allowed && context.parameters.privilegeDenied.raw === 'hide');

        this.container.classList.toggle('FormActionButton--hidden', hidden);

        if (hidden) {
            this.disarm(false);
            return;
        }

        /*
         * Three reasons to be inert, and they are different reasons.
         *
         * `mode.isControlDisabled` is the form's own answer — a read-only form,
         * a locked field, a business rule. The privilege check is about the
         * user's roles and is this control's own. And since 0.2.0, `blocked`:
         * an action that cannot be called here, which is the maker's or the
         * record's to fix and so the one that says why (`showBlocked`).
         */
        this.hostInteractive = !context.mode.isControlDisabled && allowed && this.blocked === null;

        this.confirmRequired = asBoolean(context.parameters.confirmRequired.raw, false);
        this.writeSignal = asBoolean(context.parameters.writeSignal.raw, false);

        /*
         * Disarming lives here rather than in the click handler, so every way of
         * taking an inline confirmation away — the maker switching it off, the
         * form disabling the control, a business rule hiding it — is handled
         * once. That is what makes "armed while confirm is off" unreachable
         * rather than defended against.
         */
        if (!this.confirmRequired || !this.hostInteractive) {
            this.disarm(false);
        }

        const label = context.parameters.label.raw ?? '';
        this.labelText =
            label !== '' ? label : this.resources.getString('FormActionButton_DefaultLabel');

        const title = context.parameters.confirmTitle.raw ?? '';
        this.confirmTitleText =
            title !== '' ? title : this.resources.getString('FormActionButton_ConfirmTitle');

        const body = context.parameters.confirmText.raw ?? '';
        this.confirmBodyText =
            body !== '' ? body : this.resources.getString('FormActionButton_ConfirmText');

        const affirm = context.parameters.confirmButtonLabel.raw ?? '';
        this.confirmButtonText =
            affirm !== '' ? affirm : this.resources.getString('FormActionButton_ConfirmButton');

        this.applyIcon(context.parameters.icon.raw);
        this.paint();
        this.showBlocked();

        /*
         * `dir` on the control's own root rather than a class, so a nested
         * element can be selected with `[dir="rtl"]` from the stylesheet without
         * knowing how far up the ancestor is.
         */
        this.container.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';
    }

    /**
     * 0.2.0: what a press calls, and whether it can be called here.
     *
     * Three reasons the button is off *for its action*, each with a sentence:
     * a name the Web API could never take, a host with no Dataverse behind it
     * (canvas, PCFHub's demo — `organisationUrl` answers `null`), and a call
     * that needs the record on a record not saved yet. The last one clears on
     * the same instance after the first save: the platform hands it the new id
     * without a remount (P1).
     */
    private readAction(context: ComponentFramework.Context<IInputs>): void {
        const parameters = context.parameters.actionParameters?.raw;

        this.actionSetting = readActionSetting(
            context.parameters.actionName?.raw,
            context.parameters.actionBinding?.raw,
            context.parameters.resultProperty?.raw,
        );
        this.parametersText = typeof parameters === 'string' ? parameters.trim() : '';
        this.clientUrl = organisationUrl(context);
        this.metadataUtils = (context as unknown as { utils?: MetadataUtils }).utils;

        const setting = this.actionSetting;

        if (setting.kind === 'none') {
            this.blocked = null;
        } else if (setting.kind === 'invalid') {
            this.blocked = this.resources.getString(setting.key).replace('{0}', setting.detail);
        } else if (this.clientUrl === null) {
            this.blocked = this.resources.getString('FormActionButton_NoOrganisation');
        } else if (needsRecord(setting, this.parametersText) && this.entityId === undefined) {
            this.blocked = this.resources.getString('FormActionButton_SaveFirst');
        } else {
            this.blocked = null;
        }
    }

    /**
     * The blocked sentence in the status line, once. A render runs on every
     * change anywhere on the form, and a live region that announced on each
     * would talk over everything else. Cleared when the reason goes — unless
     * something else has spoken since, which is then the newer news.
     */
    private showBlocked(): void {
        if (this.blocked === this.blockedShown) {
            return;
        }

        if (this.blocked !== null) {
            this.announceText(this.blocked, this.actionSetting.kind === 'invalid');
        } else if (this.status.textContent === this.blockedShown) {
            this.announceText('', false);
        }

        this.blockedShown = this.blocked;
    }

    /**
     * Picks which set of colour fallbacks the stylesheet uses.
     *
     * Only the fallbacks. The stylesheet reads Fluent's design tokens through
     * `var()`, and a model-driven form mounts a `FluentProvider` above every
     * code component on the page — so on the host this control is built for,
     * this changes nothing at all. It matters where nothing does, which includes
     * PCFHub's demo harness.
     *
     * `@media (prefers-color-scheme: dark)` is the obvious hook and it asks the
     * wrong question: an app carries its own theme and the operating system's
     * setting says nothing about it. Absent means absent — no class, light
     * fallbacks, the same guess the host made by not saying.
     */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('FormActionButton--dark', isDarkTheme);
    }

    /**
     * Which record this is, if the host will say.
     *
     * `context.mode.contextInfo` is **absent from
     * `@types/powerapps-component-framework` altogether**, so reaching it costs
     * a cast, and it is absent in canvas at runtime. The framework's own FAQ
     * says components deliberately do not carry the record's identity, "because
     * they need to be supported on multiple surfaces where this information may
     * not be available" — so absence here is the documented state, not a fault.
     *
     * Validated rather than trusted. It is fed to `hasEntityPrivilege` and
     * published in the event payload, and an entity name that cannot be a
     * logical name is not one this control passes on.
     */
    private readIdentity(context: ComponentFramework.Context<IInputs>): void {
        const info = (
            context.mode as unknown as {
                contextInfo?: { entityId?: string; entityTypeName?: string };
            }
        ).contextInfo;

        const name = info?.entityTypeName;
        this.entityTypeName = typeof name === 'string' && LOGICAL_NAME.test(name) ? name : undefined;

        const id = info?.entityId;
        this.entityId = typeof id === 'string' && id !== '' ? id : undefined;
    }

    /**
     * Whether the user may do the thing the maker said this button does.
     *
     * **Every way of not knowing answers `true`**, and that is the decision
     * rather than laziness. `context.utils` is absent in canvas and on any host
     * without the `Utility` feature; `contextInfo` is absent wherever the record
     * is not published. A control that hid itself in those cases would go
     * missing for reasons that have nothing to do with the user's roles, and
     * nothing on screen would say so — whereas letting the press through leaves
     * the server to refuse, which at least produces a message somebody can act
     * on.
     *
     * `hasEntityPrivilege` is **synchronous and returns a boolean**, alone among
     * `context.utils`. A host that returned a promise instead would be truthy
     * and would therefore never gate, which is the same safe direction.
     */
    private hasPrivilege(context: ComponentFramework.Context<IInputs>): boolean {
        const wanted = context.parameters.requirePrivilege.raw;

        if (wanted === null || wanted === 'none') {
            return true;
        }

        const privilege = PRIVILEGE_TYPES[wanted];
        const utils = context.utils;
        const ask = utils?.hasEntityPrivilege;

        if (privilege === undefined || typeof ask !== 'function' || this.entityTypeName === undefined) {
            return true;
        }

        try {
            // `.call(utils, …)` rather than a bare call: pulling the method off
            // the bag loses its `this`, and the bag is a platform object whose
            // implementation is not visible from here.
            return Boolean(
                ask.call(
                    utils,
                    this.entityTypeName,
                    privilege as ComponentFramework.PropertyHelper.Types.PrivilegeType,
                    PRIVILEGE_DEPTH,
                ),
            );
        } catch (error) {
            console.error('FormActionButton: hasEntityPrivilege threw.', error);
            return true;
        }
    }

    /**
     * Records the maker's choice. Which glyph is actually *shown* is `paint()`'s
     * business, because the spinner takes the same slot.
     */
    private applyIcon(raw: string | null): void {
        this.iconName = raw === 'send' || raw === 'delete' ? raw : null;
        this.container.classList.toggle('FormActionButton--has-icon', this.iconName !== null);
    }

    /**
     * One glyph, or none, or the spinner instead.
     *
     * **The spinner replaces the icon rather than joining it**, and that is the
     * reason this is not part of `applyIcon`. A send arrow beside a spinning
     * ring is two leading marks competing for the same slot, and it reads as
     * clutter rather than as progress. Found by taking a screenshot of the busy
     * state, which is the only way this kind of thing gets found.
     */
    private applyGlyphs(): void {
        const shown = this.phase === 'busy' ? null : this.iconName;

        (Object.keys(this.icons) as IconName[]).forEach((key) => {
            const icon = this.icons[key];

            if (key === shown) {
                icon.removeAttribute('hidden');
            } else {
                // The attribute, plus a `[hidden]` rule in the stylesheet: an
                // author `display` on the glyph beats the user-agent one.
                icon.setAttribute('hidden', 'hidden');
            }
        });
    }

    /**
     * The button's text, which is also its accessible name, and its enabledness.
     *
     * One function for both because they cannot disagree: every phase that
     * changes the caption also changes whether a click is accepted, and two
     * functions is how those drift.
     */
    private paint(): void {
        /*
         * No `aria-label`. The button says what it does in words, so a label
         * would be a second name that can disagree with the first — and when it
         * is armed, the visible text and the announced text have to be the same
         * sentence or the confirmation means two different things depending on
         * how you are reading it.
         */
        /*
         * **Busy does NOT change the caption**, and that is the one place this
         * control's two feedback channels had to be told apart.
         *
         * An armed confirmation changes the *question* — "Delete record"
         * becomes "Delete permanently" — so the caption has to carry it, and the
         * live region only backs it up. Busy changes nothing about what the
         * button is; it is still the Approve button, it is simply working. So
         * the spinner and `aria-busy` carry "working" and the live region
         * carries the handler's sentence.
         *
         * Putting the busy message in the caption as well shipped for an
         * afternoon, and what it looked like when a screenshot was finally
         * taken of it was the same sentence printed twice, once on the button
         * and once underneath.
         */
        this.caption.textContent = this.phase === 'armed' ? this.confirmButtonText : this.labelText;

        const busy = this.phase === 'busy';

        this.applyGlyphs();

        if (busy) {
            this.spinner.removeAttribute('hidden');
        } else {
            this.spinner.setAttribute('hidden', 'hidden');
        }

        const enabled = this.hostInteractive && this.phase !== 'asking' && this.phase !== 'busy';

        this.button.disabled = !enabled;
        /*
         * `aria-busy` on the button rather than the container: it is the button
         * that is unavailable, and a container marked busy takes the live region
         * with it, which is where the explanation is.
         */
        this.button.setAttribute('aria-busy', busy ? 'true' : 'false');

        this.container.classList.toggle('FormActionButton--disabled', !enabled);
        this.container.classList.toggle('FormActionButton--armed', this.phase === 'armed');
        this.container.classList.toggle('FormActionButton--busy', busy);
    }

    private onClick = (): void => {
        /*
         * Guarded here rather than trusted to `button.disabled`. A disabled
         * button does not fire a click in a browser, but the control should not
         * depend on that: `dev/dom.js` dispatches whatever it is handed, and a
         * control whose safety rests on the DOM refusing is one nothing can
         * assert.
         */
        if (!this.hostInteractive) {
            return;
        }

        /*
         * Single-flight, and it is a state check rather than a boolean because
         * the states already exist. A double press before a modal dialog paints
         * is the ordinary way to get two dialogs and two actions.
         */
        if (this.phase === 'asking' || this.phase === 'busy') {
            return;
        }

        if (this.phase === 'armed') {
            this.disarm(false);
            this.raise('confirm');
            return;
        }

        if (!this.confirmRequired) {
            this.raise('press');
            return;
        }

        /*
         * **Presence is per method, not per bag.** `context.navigation` is typed
         * non-optional, which is a claim about the type definitions rather than
         * about the host, and the dialogs go missing independently of `openUrl`.
         */
        const ask = this.navigation?.openConfirmDialog;

        if (typeof ask === 'function') {
            this.askPlatform(ask);
            return;
        }

        /*
         * No dialog on this host, so confirm inline instead.
         *
         * The skill's *Confirm, then destroy* warns against substituting the
         * inline two-step for the platform dialog where the dialog is missing,
         * and it is right about the case it describes: pcf-row-commands cannot
         * offer a delete in canvas, because the host that lacks the dialog also
         * lacks the `webAPI` that would do the deleting, so an inline
         * confirmation there is a nicer way of failing.
         *
         * This control is the other case. The action is *raising an event*, and
         * that works on every host — nothing about the press depends on the
         * dialog existing. So the fallback is a real degradation of the asking,
         * not a pretence about the doing, and refusing to offer the button at
         * all would remove a working feature to make a point.
         */
        this.arm();
    };

    /**
     * Ask with the platform's own dialog.
     *
     * **A cancel arrives as a resolve.** The promise settling means the dialog
     * closed, not that the user agreed — so the answer is read off `confirmed`,
     * and a cancel is treated as *nothing happened*: no output, no event, no
     * announcement of failure, because the user did it on purpose.
     */
    private askPlatform(
        ask: ComponentFramework.Navigation['openConfirmDialog'],
    ): void {
        const navigation = this.navigation;
        const token = this.token;

        this.phase = 'asking';
        this.paint();

        // `.call(navigation, …)` rather than a bare call: pulling the method off
        // the bag loses its `this`.
        void ask
            .call(navigation as ComponentFramework.Navigation, {
                title: this.confirmTitleText,
                text: this.confirmBodyText,
                confirmButtonLabel: this.confirmButtonText,
            })
            .then((response) => {
                if (!this.settle(token)) {
                    return;
                }

                if (response?.confirmed) {
                    this.raise('confirm');
                }
            })
            .catch((error: unknown) => {
                if (!this.settle(token)) {
                    return;
                }

                /*
                 * A refusal is not a cancel. The user was never asked, so the
                 * action must not happen — and unlike a cancel this is worth
                 * saying out loud, because from the user's side the button did
                 * nothing for no visible reason.
                 */
                console.error('FormActionButton: the confirmation dialog could not be opened.', error);
                this.announceText(
                    describeError(error) || this.resources.getString('FormActionButton_Failed'),
                    false,
                );
            });
    }

    /**
     * Return the button to idle after an asynchronous step, or refuse to.
     *
     * `false` means this continuation belongs to a press that is over — the
     * control was destroyed, or the user pressed again and something newer is in
     * flight. Both are ordinary on a form, and neither may write to the DOM.
     */
    private settle(token: number): boolean {
        if (this.destroyed || token !== this.token) {
            return false;
        }

        this.phase = 'idle';
        this.paint();

        return true;
    }

    /**
     * Leaving the button abandons an inline confirmation, silently.
     *
     * Silently because the user is already somewhere else: a live region firing
     * after focus has moved describes a control the user is no longer looking
     * at. Escape is the deliberate cancel and it does announce.
     */
    private onBlur = (): void => {
        this.disarm(false);
    };

    private onKeyDown = (event: Event): void => {
        if (this.phase !== 'armed' || (event as KeyboardEvent).key !== 'Escape') {
            return;
        }

        if (typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        this.disarm(true);
    };

    private arm(): void {
        this.phase = 'armed';
        this.paint();
        this.announce('FormActionButton_Armed');

        this.confirmTimer = window.setTimeout(() => {
            this.confirmTimer = undefined;
            this.disarm(true, 'FormActionButton_TimedOut');
        }, CONFIRM_TIMEOUT_MS);
    }

    private disarm(announce: boolean, key = 'FormActionButton_Cancelled'): void {
        this.clearConfirmTimer();

        if (this.phase !== 'armed') {
            return;
        }

        this.phase = 'idle';
        this.paint();

        if (announce) {
            this.announce(key);
        }
    }

    /**
     * Raise the event, then write the outputs unless the handler said not to.
     *
     * **In that order, which is the reverse of the canvas sibling's**, and the
     * reason is `preventDefault`: a veto cannot un-write an output, so the
     * handler has to run while the decision is still open. The `try` is what
     * keeps the other channels safe from a handler that throws — a throw is not
     * a veto, so the outputs are written anyway.
     */
    private raise(action: 'press' | 'confirm'): void {
        const token = (this.token += 1);
        const nextCount = this.pressCount + 1;

        this.prevented = false;
        this.raising = token;

        const events = this.events;

        if (typeof events?.onAction === 'function') {
            try {
                /*
                 * Called as a member, never through a saved reference. `const
                 * raise = events.onAction; raise();` drops `this`, and the bag
                 * is a platform object whose implementation is not visible from
                 * here.
                 */
                events?.onAction?.(this.buildPayload(action, nextCount, token));
            } catch (error) {
                // The maker's handler threw. Their problem to fix, and not a
                // reason for this control to stop working — but silence would
                // leave them with a button that half-works and no clue why.
                console.error('FormActionButton: the onAction handler threw.', error);
            }
        }

        this.raising = 0;

        if (this.prevented) {
            return;
        }

        this.pressCount = nextCount;
        this.lastAction = action;

        if (this.writeSignal) {
            /*
             * Pipe-delimited rather than JSON, because the audience includes a
             * business rule and a real-time workflow, neither of which can parse
             * JSON. The count is in it so that two identical presses are two
             * different values — a column set to the same string twice fires no
             * OnChange, which is the same trap `pressCount` exists for.
             */
            this.signal = `${action}|${nextCount}`;
        }

        this.notifyOutputChanged();

        /*
         * 0.2.0: the action, after the outputs — the press has happened whatever
         * the call then does, and `actionStatus` reports the call on its own. A
         * veto returned above, so `preventDefault()` cancels the call too; a
         * handler that threw did not veto, so the call goes ahead.
         */
        if (this.actionSetting.kind === 'action') {
            this.runAction(this.actionSetting, token, nextCount);
        }
    }

    /**
     * The object a form script receives.
     *
     * Every callback closes over `token` and checks it, so a handler that keeps
     * the payload — which an async one does by construction — can only ever talk
     * about its own press.
     */
    private buildPayload(
        action: 'press' | 'confirm',
        pressCount: number,
        token: number,
    ): ActionPayload {
        /*
         * A button with an action owns its busy state and its result: the call
         * starts as the handler returns and reports itself. A handler's own
         * `setBusy`/`setResult` would race it for the same two slots, so for
         * such a press they are refused, out loud, rather than half-applied.
         */
        const owned = this.actionSetting.kind === 'action';
        const refuse = (name: string): void => {
            console.warn(
                `FormActionButton: ${name}() was ignored — this button calls an action, and the call reports its own`
                    + ' result. Use preventDefault() to stop the call, or leave Action name empty to answer from the handler.',
            );
        };

        return {
            action,
            pressCount,
            label: this.labelText,
            entityTypeName: this.entityTypeName,
            entityId: this.entityId,

            preventDefault: (): void => {
                if (this.destroyed || this.raising !== token) {
                    console.warn(
                        'FormActionButton: preventDefault() was called after the press was decided,'
                            + ' and had no effect. It is synchronous only — call it before the'
                            + ' handler returns.',
                    );
                    return;
                }

                this.prevented = true;
            },

            setBusy: (message?: string): void => {
                if (this.destroyed || token !== this.token) {
                    return;
                }

                if (owned) {
                    refuse('setBusy');
                    return;
                }

                /*
                 * The handler's sentence goes to the live region and nowhere
                 * else — the caption keeps saying what the button is. Nothing
                 * holds it afterwards, so there is nothing for a later
                 * `render()` to overwrite: the announcement already happened.
                 */
                const busyText =
                    typeof message === 'string' && message !== ''
                        ? message
                        : this.resources.getString('FormActionButton_Busy');

                this.clearConfirmTimer();
                this.phase = 'busy';
                this.paint();
                this.announceText(busyText, false);

                this.watchBusy(token);
            },

            setResult: (result: { ok: boolean; message?: string }): void => {
                if (this.destroyed || token !== this.token) {
                    return;
                }

                if (owned) {
                    refuse('setResult');
                    return;
                }

                this.clearBusyTimer();
                this.phase = 'idle';
                this.paint();

                const failed = result?.ok === false;
                const message =
                    typeof result?.message === 'string' && result.message !== ''
                        ? result.message
                        : this.resources.getString(
                            failed ? 'FormActionButton_Failed' : 'FormActionButton_Done',
                        );

                this.announceText(message, failed);
            },
        };
    }

    /**
     * Release a button nobody reports back for, after `BUSY_TIMEOUT_MS`.
     * A handler's `setBusy()` and the control's own call share it.
     */
    private watchBusy(token: number): void {
        this.clearBusyTimer();
        this.busyTimer = window.setTimeout(() => {
            this.busyTimer = undefined;

            if (this.destroyed || token !== this.token || this.phase !== 'busy') {
                return;
            }

            this.phase = 'idle';
            this.paint();
            this.announce('FormActionButton_Stalled', true);
        }, BUSY_TIMEOUT_MS);
    }

    /**
     * 0.2.0: call the action once for a committed press, and say how it went.
     *
     * Busy for the length of it — the spinner, `aria-busy`, "Running…" — under
     * the same watchdog a handler's `setBusy()` gets, and latched to its press
     * the way every payload callback is: an answer for a press that is over is
     * dropped.
     *
     * What the button says afterwards: the response property the maker named,
     * when the action returns one; **"Sent."** for a 204 — an action with no
     * response properties, which is what a flow's trigger is, and whose flow
     * runs afterwards on its own; "Done." for another success; and the server's
     * own sentence for a refusal, with the case-sensitivity hint when the name
     * is what it could not find (pcf-row-commands P2).
     */
    private runAction(setting: Extract<ActionSetting, { kind: 'action' }>, token: number, pressCount: number): void {
        const base = this.clientUrl as string;
        const id = this.entityId ?? '';
        const table = this.entityTypeName;
        const getString = (key: string): string => this.resources.getString(key);

        this.clearConfirmTimer();
        this.phase = 'busy';
        this.paint();
        this.announce('FormActionButton_Running');
        this.watchBusy(token);

        const address = table === undefined ? Promise.resolve(null) : this.recordKeys(base, table);

        void Promise.all([this.parameters(base), address])
            .then(([read, keys]): Finish | Promise<Finish> => {
                if (!read.ok) {
                    return {
                        ok: false,
                        message: 'whole' in read ? read.reason : getString('FormActionButton_BadParameters').replace('{0}', read.reason),
                        result: '',
                    };
                }

                if (keys === null && needsRecord(setting, this.parametersText)) {
                    return { ok: false, message: getString('FormActionButton_NoAddress'), result: '' };
                }

                const def: ActionDef = { name: setting.name, bound: setting.bound, parameters: read.parameters, result: setting.result };

                return callAction(fetch as unknown as ActionFetch, base, def, keys ?? { table: table ?? '', set: '', primaryId: '' }, id)
                    .then((outcome): Finish => (outcome.ok
                        ? {
                            ok: true,
                            message: outcome.result ?? getString(outcome.status === 204 ? 'FormActionButton_Sent' : 'FormActionButton_Done'),
                            result: outcome.result ?? '',
                        }
                        : { ok: false, message: this.refusalText(outcome.refusal, setting.name), result: '' }));
            })
            .then(
                (finish) => this.finishAction(token, pressCount, finish),
                (error: unknown) => this.finishAction(token, pressCount, {
                    ok: false,
                    message: describeError(error) || getString('FormActionButton_Failed'),
                    result: '',
                }),
            );
    }

    /** The answer, on screen and on the outputs — unless its press is over. */
    private finishAction(token: number, pressCount: number, finish: Finish): void {
        if (this.destroyed || token !== this.token) {
            return;
        }

        this.clearBusyTimer();
        this.phase = 'idle';
        this.paint();
        this.announceText(finish.message, !finish.ok);

        this.actionStatus = statusText(pressCount, finish.ok);
        this.actionResult = finish.result;
        this.notifyOutputChanged();
    }

    /** A refusal as the user reads it, and its code for whoever opens the console. */
    private refusalText(refusal: Refusal, name: string): string {
        console.warn(`FormActionButton: the action ${name} was refused`, refusal.status, refusal.code ?? '', refusal.sentence);

        // The server's not-found sentence has no full stop (measured), and the hint follows it on one line.
        return refusal.nameWrong
            ? `${refusal.sentence}${/[.!?…]$/.test(refusal.sentence) ? '' : '.'} ${this.resources
                .getString('FormActionButton_ActionNameHint')
                .replace('{0}', name)}`
            : refusal.sentence;
    }

    /**
     * The parameters, as JSON: written into the property, or held by the web
     * resource it names — a form keeps 100 characters of a static value. A web
     * resource is fetched once and kept; one that could not be had is asked
     * for again on the next press, so a fix published meanwhile is picked up.
     */
    private parameters(base: string): Promise<ParametersLoad> {
        const text = this.parametersText;

        if (text === '') {
            return Promise.resolve({ ok: true, parameters: {} });
        }

        if (isInlineParameters(text)) {
            return Promise.resolve(readParameters(text));
        }

        const key = `${base}\u0000${text}`;

        if (this.parametersLoad?.key === key) {
            return this.parametersLoad.read;
        }

        const read = loadSource(text, isInlineParameters, base, fetch as unknown as SourceFetch).then((load): ParametersLoad => {
            if (load.state === 'ready') {
                return readParameters(load.text.trim());
            }

            const name = 'name' in load ? load.name : text;
            const sentence = load.state === 'notFound' ? 'FormActionButton_ParametersMissing' : 'FormActionButton_ParametersUnreadable';

            return { ok: false, reason: this.resources.getString(sentence).replace('{0}', name), whole: true };
        });

        this.parametersLoad = { key, read };
        void read.then((result) => {
            if (!result.ok && this.parametersLoad?.key === key) {
                this.parametersLoad = null;
            }
        });

        return read;
    }

    /**
     * A table's entity set and id column — from `getEntityMetadata` on a form,
     * measured at 0–1 ms (P2) — once per table. A table nobody could describe is
     * asked about again on the next press, not remembered as unaddressable.
     */
    private recordKeys(base: string, table: string): Promise<RecordKeys | null> {
        const cached = this.keysLoads.get(table);

        if (cached) {
            return cached;
        }

        const load = loadRecordKeys(this.metadataUtils, base, fetch as unknown as DefinitionsFetch, table);

        this.keysLoads.set(table, load);
        void load.then((keys) => {
            if (keys === null) {
                this.keysLoads.delete(table);
            }
        });

        return load;
    }

    private announce(key: string, failed = false): void {
        this.announceText(this.resources.getString(key), failed);
    }

    /**
     * Blanked before it is set, so a repeat announces.
     *
     * A live region announces a *change* to its contents, so writing the same
     * string twice is silent — and two identical confirmations in a row is
     * exactly what this control produces. The region is emptied rather than
     * hidden for the same family of reason: one removed from the accessibility
     * tree between announcements is one some screen readers stop watching.
     */
    private announceText(message: string, failed: boolean): void {
        this.status.textContent = '';
        this.status.textContent = message;
        this.container.classList.toggle('FormActionButton--error', failed);
    }

    private clearConfirmTimer(): void {
        if (this.confirmTimer !== undefined) {
            window.clearTimeout(this.confirmTimer);
            this.confirmTimer = undefined;
        }
    }

    private clearBusyTimer(): void {
        if (this.busyTimer !== undefined) {
            window.clearTimeout(this.busyTimer);
            this.busyTimer = undefined;
        }
    }
}

/**
 * A TwoOptions the platform may hand over as a string.
 *
 * `default-value="false"` reaches PCFHub's demo harness as the string "false",
 * and `Boolean("false")` is `true` — so a control reading `raw` directly gets
 * the opposite of its own declared default on the one surface the public sees.
 */
function asBoolean(raw: unknown, fallback: boolean): boolean {
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (raw === 'false' || raw === '0' || raw === 0) {
        return false;
    }
    if (raw === 'true' || raw === '1' || raw === 1) {
        return true;
    }
    return fallback;
}

/**
 * The message out of a platform rejection, which is not an `Error`.
 *
 * A navigation rejection is a plain object carrying `errorCode` and `message`,
 * exactly as the Client API's `errorCallback` documents — so the reflex
 * `error instanceof Error ? error.message : String(error)` falls through to
 * `String({ … })` and renders the literal string `[object Object]` where the
 * platform's explanation should be.
 */
function describeError(error: unknown): string {
    if (error === null || error === undefined) {
        return '';
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === 'object') {
        const message = (error as { message?: unknown }).message;

        if (typeof message === 'string' && message !== '') {
            return message;
        }
    }

    return typeof error === 'string' ? error : '';
}

/**
 * An icon, inline.
 *
 * Never an `<img src>`, file or data URL. An image behind `src` renders as an
 * isolated document that cannot see this control's stylesheet, so `currentColor`
 * inside it resolves to black and a dark form gets a black glyph on a dark
 * button. pcf-file-drop shipped exactly that and it was found on a real form.
 */
function createIcon(name: IconName): Element {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute(
        'class',
        ICON_FLIPS_IN_RTL[name]
            ? 'FormActionButton-icon FormActionButton-icon--flip'
            : 'FormActionButton-icon',
    );
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    /*
     * Without this, some assistive tooling puts a focusable `<svg>` in the tab
     * order — inside a button that is already a tab stop, which produces a stop
     * that does nothing.
     */
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);

    return svg;
}
