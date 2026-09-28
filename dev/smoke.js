/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/FormActionButton/bundle.js` the way a form would, drives the control
 * through the states a form can put it in, and asserts what it did.
 *
 * Why it exists alongside `npm start` and `dev/harness.html`: both of those
 * *show* you the control, and the states that matter most are ones nobody
 * thinks to look at — a column the user cannot read, a business rule that
 * failed, a host with no column metadata, a cleared value that has to travel
 * back as `null` rather than `undefined`. Those are decisions, they are what
 * regresses, and here they are assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking — webpack, the externals and the manifest all sit between
 * the source and what a form actually loads. CI runs it after the msbuild pack,
 * so there it drives the production bundle.
 *
 * **What passing here does NOT mean.** Every value below is supplied by this
 * file. It cannot tell you that the control looks right, that the stylesheet
 * applies, that focus order works, that a real form hands down what these
 * fixtures hand down, or that a save persists anything. Keep the answers to
 * those in SPEC.md under "Not verified".
 *
 * **And a stub must never be more capable than the thing it stands in for.**
 * `dev/host.js` withholds `security`, `attributes` and `fluentDesignLanguage`
 * exactly where the platform withholds them. When you add to it, stub the
 * refusals first — the argument the call requires, the field it omits, the
 * empty collection it hands back. If you cannot say what the real call
 * withholds, the stub is a guess and the assertions resting on it prove
 * nothing.
 *
 * ---
 *
 * **The assertions below the divider are a worked example. Replace them.**
 * Everything above the divider is plumbing that works for any field control;
 * the examples exercise the scaffolded control and are meant to be thrown away
 * with it.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Resolved from this file rather than from the working directory, so the script
// behaves the same run directly or through npm.
const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');

const BUNDLE = path.join(root, 'out', 'controls', 'FormActionButton', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/FormActionButton. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date`, `setInterval` and `setTimeout` the control closes over are the ones
 * installed here. That is what makes a control with a clock testable without
 * an injectable clock parameter — which would be production code bent to suit
 * a harness, and the only reason that seam would exist.
 *
 * A control with no timers is unaffected by this: nothing schedules, nothing
 * fires, and `time.pending()` stays at zero. Keep it anyway — the teardown
 * assertion at the bottom of this file is written against it, and it is the
 * assertion worth keeping when the worked example goes.
 *
 * The start value is arbitrary and fixed. A suite that starts at "now" asserts
 * something slightly different every time it runs.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

const source = fs.readFileSync(BUNDLE, 'utf8');

/*
 * The platform libraries, supplied under the names the bundle actually asks
 * for — read out of the bundle rather than written down here.
 *
 * A `<platform-library>` entry becomes a webpack external, and the global it
 * compiles to carries a version in its name. **That version is not the one the
 * manifest declares.** `pcf-scripts` maps a declared version onto the platform
 * build it supports, so Fluent `9.46.2` arrives as `FluentUIReactv940` and
 * React `16.14.0` as `Reactv16`. Hardcoding either is a trap that springs on
 * the next version bump, with a `ReferenceError` naming a global that appears
 * nowhere in the repository.
 *
 * A standard control has no externals at all, in which case both lists are
 * empty and nothing below runs.
 */
const reactGlobals = [...new Set(source.match(/\bReactv[\w]*\b/g) || [])];
const fluentGlobals = [...new Set(source.match(/\bFluentUIReact[\w]*\b/g) || [])];

let React = null;

if (reactGlobals.length > 0) {
    React = require(path.join(root, 'node_modules', 'react'));
    reactGlobals.forEach((name) => {
        global[name] = React;
    });
}

/*
 * Fluent is stubbed rather than loaded, the way the grid rig stubs it: every
 * component resolves to its own name as an element type, so
 * `React.createElement(Input, …)` produces `{ type: 'Input', props }` and the
 * props the control passed survive for inspection. These assertions are about
 * the control's decisions, not about how Fluent renders them — and Fluent 9
 * ships no UMD build, so there is nothing to load in a browser either.
 */
const fluent = new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined) });

fluentGlobals.forEach((name) => {
    global[name] = fluent;
});

vm.runInThisContext(source, { filename: 'bundle.js' });

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source" — which
// would otherwise look identical in the output.
const marked = (key) => `resx:${key}`;

/**
 * What the manifest's `default-value` attributes say.
 *
 * Stated here rather than left to `undefined`, because the platform hands a
 * declared default down as a real value and a control read against `undefined`
 * is being tested on a host that does not exist. Every assertion that cares
 * about one of these overrides it explicitly.
 *
 * Note `confirmRequired: false` and `writeSignal: false` as **booleans**. The
 * separate assertion below that a stringly-typed `"false"` is read as false is
 * about PCFHub's demo harness, which hands the raw XML over as a string — and
 * `Boolean("false")` is `true`.
 */
const MANIFEST_DEFAULTS = {
    label: 'Submit',
    icon: 'none',
    confirmRequired: false,
    confirmTitle: '',
    confirmText: '',
    confirmButtonLabel: '',
    writeSignal: false,
    requirePrivilege: 'none',
    privilegeDenied: 'disable',
};

/**
 * Every control mounted and not yet destroyed.
 *
 * A suite that mounts and walks away is testing something other than what it
 * says: an abandoned control keeps its timers and its listeners, so the next
 * section's counts include them. That is the leak the teardown assertion exists
 * to catch, and asserting it from inside one proves nothing.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

function mount(options = {}) {
    const calls = [];
    const container = dom.createElement('div');

    /* Every payload the control raised, in order, kept for inspection. */
    const payloads = [];

    /*
     * The events bag.
     *
     *   - `handler: fn`  — a form script. `fn` is called with the payload, so
     *                      an assertion can call `preventDefault()`, `setBusy()`
     *                      or `setResult()` straight back into the control, which
     *                      is what a real `addEventHandler` handler does.
     *   - `events: null` — a host that publishes no bag at all. The platform
     *                      types make `context.events` non-optional, so nothing
     *                      will ever force the control to guard it, and a
     *                      manifest declaration is a claim about the schema
     *                      rather than about the runtime.
     */
    const events =
        options.events === null
            ? null
            : {
                onAction: (payload) => {
                    payloads.push(payload);

                    if (typeof options.handler === 'function') {
                        options.handler(payload);
                    }
                },
            };

    const context = host.createContext({
        getString: marked,
        ...options,
        events,
        calls,
        inputs: { ...MANIFEST_DEFAULTS, ...(options.inputs || {}) },
    });

    const instance = new registration.ctor();

    /*
     * The notification goes into the same log as the platform calls, so an
     * assertion can be about the *order* of the two things a press does. Here
     * the order is the reverse of this control's canvas sibling: the event is
     * raised first, so that a handler can veto the outputs — which it cannot do
     * after they have been written.
     */
    instance.init(
        context,
        () => {
            calls.push('notifyOutputChanged');
        },
        {},
        container,
    );

    instance.updateView(context);

    const handle = {
        instance,
        container,
        calls: () => calls,
        payloads: () => payloads,
        outputs: () => instance.getOutputs(),
        notifications: () => calls.filter((call) => call === 'notifyOutputChanged').length,
        raised: () => payloads.length,
        dialogs: () => calls.filter((call) => call.indexOf('navigation.openConfirmDialog') === 0).length,
        find: (selector) => container.querySelector(selector),
        findAll: (selector) => Array.from(container.querySelectorAll(selector)),
        button: () => container.querySelector('.FormActionButton-button'),
        caption: () => container.querySelector('.FormActionButton-caption').textContent,
        status: () => container.querySelector('.FormActionButton-status').textContent,
        press: () => container.querySelector('.FormActionButton-button').click(),
        /** A fresh context, as the platform hands one down on every change. */
        update: (next = {}) =>
            instance.updateView(
                host.createContext({
                    getString: marked,
                    ...options,
                    ...next,
                    events,
                    calls,
                    inputs: {
                        ...MANIFEST_DEFAULTS,
                        ...(options.inputs || {}),
                        ...(next.inputs || {}),
                    },
                }),
            ),
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(handle);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
    };

    live.push(handle);

    return handle;
}

/** An event `dev/dom.js` will deliver: no bubbling, no synthesis. */
function fire(element, type, extra = {}) {
    element.dispatchEvent({ type, target: element, preventDefault: () => {}, ...extra });
}

/**
 * Let the promise chain behind `openConfirmDialog` settle.
 *
 * Microtasks, not timers — `dev/clock.js` replaces `setTimeout`, and a promise
 * never went through it. Four turns because the control's own chain is two
 * (`then`, and the `raise` inside it) and a bare `await` is one.
 */
async function settled() {
    for (let turn = 0; turn < 4; turn += 1) {
        await Promise.resolve();
    }
}

/**
 * Record what is written to an element's `textContent`, rather than what is left
 * in it.
 *
 * The only honest way to test a live region outside a browser. A region
 * announces a *change*, so the control blanks it before every announcement —
 * and `dev/dom.js` records only the final value, where the blank and the second
 * identical message are indistinguishable from one write that changed nothing.
 */
function recordWrites(element) {
    const writes = [];
    const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        'textContent',
    );

    Object.defineProperty(element, 'textContent', {
        configurable: true,
        get: descriptor.get,
        set(value) {
            writes.push(value);
            descriptor.set.call(this, value);
        },
    });

    return writes;
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/*
 * Everything below is asynchronous, because the platform's confirmation dialog
 * is. There is no framework here to sequence it, so it is one function and the
 * report runs when it settles — and an assertion that throws must not be
 * swallowed into an unhandled rejection, which would exit 0 with half a suite
 * printed. Hence the explicit catch.
 */
main().then(report, (error) => {
    console.error(error);
    process.exit(1);
});

async function main() {
    /* ----------------------------------------------------------- the button */

    const plain = mount({ inputs: { label: 'Approve' } });

    check(
        'renders a button that is a button, not a submit',
        plain.button() !== null && plain.button().type === 'button',
        `type=${plain.button() && plain.button().type}`,
    );

    check('says what the maker told it to say', plain.caption() === 'Approve', plain.caption());

    check(
        'falls back to a localised label when the maker cleared it',
        mount({ inputs: { label: '' } }).caption() === 'resx:FormActionButton_DefaultLabel',
    );

    check(
        'names itself with its own text rather than a second name that could disagree',
        plain.button().getAttribute('aria-label') === null,
    );

    const glyphs = mount({ inputs: { icon: 'delete' } }).findAll('.FormActionButton-icon');

    check(
        'shows the glyph the maker chose and hides the other',
        glyphs.length === 2 && glyphs.filter((g) => !g.hasAttribute('hidden')).length === 1,
        `${glyphs.filter((g) => !g.hasAttribute('hidden')).length} of ${glyphs.length} shown`,
    );

    /* ------------------------------------------------------- a plain press */

    const pressed = mount({ inputs: { label: 'Approve' } });

    pressed.press();

    check('a press raises the event exactly once', pressed.raised() === 1, String(pressed.raised()));

    check(
        'and notifies the platform exactly once',
        pressed.notifications() === 1,
        String(pressed.notifications()),
    );

    /*
     * The ordering, and it is the reverse of the canvas sibling's on purpose.
     * `preventDefault()` cannot un-write an output, so the handler has to run
     * while the decision is still open.
     */
    check(
        'the event is raised BEFORE the outputs are notified, so a handler can still veto',
        pressed.calls().findIndex((call) => call.indexOf('events.onAction') === 0) !== -1
            && pressed.calls().findIndex((call) => call.indexOf('events.onAction') === 0)
                < pressed.calls().indexOf('notifyOutputChanged'),
        pressed.calls().join(' → '),
    );

    check(
        'the outputs say what happened and that it happened',
        pressed.outputs().lastAction === 'press' && pressed.outputs().pressCount === 1,
        JSON.stringify(pressed.outputs()),
    );

    /*
     * The anchor column, untouched. This is the guarantee that makes it safe to
     * bind this control to a column somebody's business depends on, and it rests
     * entirely on `getOutputs()` omitting the key — `undefined` means "no
     * change", and every other control in this catalogue treats that as a bug.
     */
    check(
        'and the bound column is not written, because writeSignal is off',
        !Object.prototype.hasOwnProperty.call(pressed.outputs(), 'signal'),
        JSON.stringify(pressed.outputs()),
    );

    const payload = pressed.payloads()[0];

    check(
        'the payload says which press this was and what kind',
        payload.action === 'press' && payload.pressCount === 1 && payload.label === 'Approve',
        JSON.stringify({ action: payload.action, pressCount: payload.pressCount, label: payload.label }),
    );

    check(
        'and carries the three callbacks a handler answers with',
        typeof payload.preventDefault === 'function'
            && typeof payload.setBusy === 'function'
            && typeof payload.setResult === 'function',
    );

    /*
     * `pressCount` is why the outputs are two properties rather than one.
     * `OnOutputChange` and a column's `OnChange` both fire on a *change*, so two
     * identical presses would otherwise be one signal and one silence.
     */
    const repeated = mount({});

    repeated.press();
    repeated.press();

    check(
        'a second identical press is observable, because the count moved',
        repeated.outputs().pressCount === 2 && repeated.notifications() === 2,
        JSON.stringify(repeated.outputs()),
    );

    /* -------------------------------------------------- a host with no bag */

    /*
     * `context.events` is typed non-optional, which is a claim about the type
     * definitions and not about the host. A control that trusted it would throw
     * here rather than degrade, and the outputs — the channel that still works —
     * would go with it.
     */
    const bagless = mount({ events: null });

    bagless.press();

    check(
        'a host that publishes no events bag still gets a working button',
        bagless.outputs().pressCount === 1 && bagless.notifications() === 1,
        JSON.stringify(bagless.outputs()),
    );

    /*
     * A handler that throws is the maker's bug, and it must not become the
     * control's. A throw is not a veto: the outputs are written anyway, so the
     * maker watching `addOnOutputChange` still sees the press.
     */
    const thrower = mount({
        handler: () => {
            throw new Error('the form script is broken');
        },
    });

    thrower.press();

    check(
        'a handler that throws does not take the outputs with it',
        thrower.outputs().pressCount === 1 && thrower.notifications() === 1,
        JSON.stringify(thrower.outputs()),
    );

    /* ------------------------------------------------------ preventDefault */

    const vetoed = mount({ handler: (event) => event.preventDefault() });

    vetoed.press();

    check(
        'preventDefault() suppresses the outputs entirely',
        vetoed.raised() === 1 && vetoed.notifications() === 0 && vetoed.outputs().pressCount === 0,
        JSON.stringify({ raised: vetoed.raised(), notifications: vetoed.notifications(), ...vetoed.outputs() }),
    );

    /*
     * And it does not consume the count. The vetoed press announced itself as
     * number 1 and did not commit, so the next press is number 1 again — which
     * is the honest reading of a property documented as "the value pressCount
     * will hold if this press commits".
     */
    vetoed.press();

    check(
        'and a vetoed press does not consume a number',
        vetoed.payloads()[1].pressCount === 1 && vetoed.outputs().pressCount === 0,
        `payloads: ${vetoed.payloads().map((p) => p.pressCount).join(', ')};`
            + ` output: ${vetoed.outputs().pressCount}`,
    );

    /*
     * The one thing `preventDefault` cannot do. The handler runs inside the
     * click path and the outputs are written the moment it returns, so a call
     * from a `.then()` is about a decision that has already been made. Ignored
     * loudly rather than applied to the next press.
     */
    let late;
    const lateVeto = mount({ handler: (event) => { late = event; } });

    lateVeto.press();
    late.preventDefault();

    check(
        'a preventDefault() from an async continuation is ignored, not applied late',
        lateVeto.outputs().pressCount === 1,
        JSON.stringify(lateVeto.outputs()),
    );

    /* ------------------------------------------------------ the signal column */

    const writing = mount({ inputs: { writeSignal: true } });

    writing.press();

    check(
        'writeSignal on writes the bound column',
        writing.outputs().signal === 'press|1',
        JSON.stringify(writing.outputs()),
    );

    writing.press();

    check(
        'and writes something different on an identical repeat, so OnChange fires',
        writing.outputs().signal === 'press|2',
        JSON.stringify(writing.outputs()),
    );

    /*
     * PCFHub's demo harness hands a manifest `default-value` over as the raw XML
     * string, and `Boolean("false")` is `true` — so a control reading `raw`
     * directly gets the opposite of its own declared default on the one surface
     * the public sees.
     */
    const stringly = mount({ inputs: { writeSignal: 'false', confirmRequired: 'false' } });

    stringly.press();

    check(
        'a TwoOptions arriving as the string "false" is read as false, not as truthy',
        stringly.raised() === 1
            && !Object.prototype.hasOwnProperty.call(stringly.outputs(), 'signal'),
        JSON.stringify(stringly.outputs()),
    );

    /* ------------------------------------------- the platform's own dialog */

    const asked = mount({ inputs: { confirmRequired: true, confirmText: 'Delete this record?' } });

    asked.press();

    check(
        'a confirmed control asks with the platform dialog where the host has one',
        asked.dialogs() === 1 && asked.raised() === 0,
        asked.calls().join(' → '),
    );

    check(
        'and disables the button while the dialog is open, so a second click cannot open a second one',
        asked.button().disabled === true,
    );

    asked.press();
    await settled();

    check(
        'a press while the dialog is in flight opens no second dialog',
        asked.dialogs() === 1,
        `${asked.dialogs()} dialog(s)`,
    );

    check(
        'and a confirmed dialog raises exactly one event',
        asked.raised() === 1 && asked.outputs().lastAction === 'confirm',
        JSON.stringify(asked.outputs()),
    );

    check(
        'the button comes back after the dialog closes',
        asked.button().disabled === false,
    );

    /*
     * **A cancel is a resolve.** The promise settling means the dialog closed,
     * not that the user agreed — so a control that acts inside `.then()` without
     * reading `confirmed` does the thing the user just declined, and one that
     * treats it as a failure shows an error for something they did on purpose.
     */
    const cancelled = mount({ dialogs: 'cancelled', inputs: { confirmRequired: true } });

    cancelled.press();
    await settled();

    check(
        'a cancelled dialog does nothing at all — no event, no output',
        cancelled.raised() === 0 && cancelled.notifications() === 0,
        JSON.stringify({ raised: cancelled.raised(), notifications: cancelled.notifications() }),
    );

    check(
        'and says nothing, because the user cancelled on purpose',
        cancelled.status() === '',
        cancelled.status(),
    );

    check('and the button is usable again', cancelled.button().disabled === false);

    /*
     * A refusal is not a cancel. The user was never asked, so the action must
     * not happen — and unlike a cancel this is worth saying, because from the
     * user's side the button did nothing for no visible reason.
     */
    const refused = mount({ dialogs: 'rejected', inputs: { confirmRequired: true } });

    refused.press();
    await settled();

    check(
        'a dialog the host refuses to open does not raise the event',
        refused.raised() === 0,
        String(refused.raised()),
    );

    check(
        'and the platform’s own explanation reaches the user rather than [object Object]',
        refused.status() === 'The dialog could not be opened.',
        refused.status(),
    );

    /* ------------------------------------------- the inline fallback */

    /*
     * `dialogs: 'absent'` removes the three dialog methods from the bag, which
     * is what canvas is. **Presence is per method, not per bag** — `openUrl`
     * survives — so a control that checked `context.navigation` once and then
     * called through it would throw here rather than degrade.
     *
     * The skill's *Confirm, then destroy* warns against substituting the inline
     * two-step for the platform dialog, and it is right about the case it
     * describes: pcf-row-commands cannot delete in canvas either, so an inline
     * confirmation there is a nicer way of failing. This control's action is
     * raising an event, which works on every host, so the fallback degrades the
     * asking and not the doing.
     */
    const inline = mount({
        dialogs: 'absent',
        inputs: { confirmRequired: true, label: 'Delete', confirmButtonLabel: 'Delete permanently' },
    });

    inline.press();

    check(
        'with no dialog on the host, the first press arms instead of acting',
        inline.raised() === 0 && inline.container.classList.contains('FormActionButton--armed'),
    );

    check(
        'and the button wears the affirmative word, which is also what the dialog would have said',
        inline.caption() === 'Delete permanently',
        inline.caption(),
    );

    inline.press();

    check(
        'the second press raises, and reports itself as confirmed',
        inline.raised() === 1 && inline.outputs().lastAction === 'confirm',
        JSON.stringify(inline.outputs()),
    );

    check(
        'and the count did not move for the arming press',
        inline.outputs().pressCount === 1,
        JSON.stringify(inline.outputs()),
    );

    const escaped = mount({ dialogs: 'absent', inputs: { confirmRequired: true } });
    const escapedWrites = recordWrites(escaped.find('.FormActionButton-status'));

    escaped.press();
    fire(escaped.button(), 'keydown', { key: 'Escape' });

    check(
        'Escape cancels an armed confirmation and announces it',
        !escaped.container.classList.contains('FormActionButton--armed')
            && escapedWrites.includes('resx:FormActionButton_Cancelled'),
        escapedWrites.join(' | '),
    );

    const blurred = mount({ dialogs: 'absent', inputs: { confirmRequired: true } });
    const blurredWrites = recordWrites(blurred.find('.FormActionButton-status'));

    blurred.press();
    fire(blurred.button(), 'blur');

    check(
        'leaving the button cancels it silently, because the user is already elsewhere',
        !blurred.container.classList.contains('FormActionButton--armed')
            && !blurredWrites.includes('resx:FormActionButton_Cancelled'),
        blurredWrites.join(' | '),
    );

    const expired = mount({ dialogs: 'absent', inputs: { confirmRequired: true } });

    expired.press();
    time.advance(5000);

    check(
        'an armed confirmation reverts itself rather than waiting for the next stray click',
        !expired.container.classList.contains('FormActionButton--armed')
            && expired.status() === 'resx:FormActionButton_TimedOut',
        expired.status(),
    );

    /*
     * Disarming lives in `render`, not in the click handler, so every way of
     * taking the confirmation away is handled once — which is what makes "armed
     * while confirm is off" unreachable rather than defended against.
     */
    const switchedOff = mount({ dialogs: 'absent', inputs: { confirmRequired: true } });

    switchedOff.press();
    switchedOff.update({ inputs: { confirmRequired: false } });

    check(
        'switching the confirmation off disarms a control that was armed',
        !switchedOff.container.classList.contains('FormActionButton--armed'),
    );

    /* -------------------------------------------------------------- busy */

    const busy = mount({
        inputs: { label: 'Approve' },
        handler: (event) => event.setBusy('Creating the invoice…'),
    });
    const busyWrites = recordWrites(busy.find('.FormActionButton-status'));

    busy.press();

    check(
        'setBusy() disables the button and marks it busy',
        busy.button().disabled === true
            && busy.container.classList.contains('FormActionButton--busy'),
        `disabled=${busy.button().disabled} / ${busy.container.className}`,
    );

    /*
     * **The message goes to the live region and NOT to the caption**, and the
     * two halves of this are one assertion because the bug is having both.
     *
     * An armed confirmation changes the question, so the caption must carry it.
     * Busy changes nothing about what the button *is* — it is still Approve, it
     * is simply working — so the spinner says "working" and the region says
     * what. Putting it in both shipped for an afternoon and was caught by
     * taking a screenshot of it: the same sentence, printed twice.
     */
    check(
        'the handler’s message is announced, and the caption still says what the button is',
        busyWrites.includes('Creating the invoice…') && busy.caption() === 'Approve',
        `caption=${busy.caption()} / announced: ${busyWrites.filter(Boolean).join(' | ')}`,
    );

    check(
        'and marks the button busy for assistive technology',
        busy.button().getAttribute('aria-busy') === 'true',
    );

    /*
     * **The spinner replaces the glyph rather than joining it.** A send arrow
     * beside a spinning ring is two leading marks competing for one slot. This
     * control shipped that for an afternoon and nothing here caught it, because
     * every assertion was about behaviour and this one is about what the thing
     * looks like — it took a screenshot of the busy state to find.
     */
    check(
        'the busy spinner replaces the maker’s glyph rather than sitting beside it',
        busy.findAll('.FormActionButton-icon').every((icon) => icon.hasAttribute('hidden'))
            && !busy.find('.FormActionButton-spinner').hasAttribute('hidden'),
        `${busy.findAll('.FormActionButton-icon').filter((i) => !i.hasAttribute('hidden')).length} glyph(s) shown beside the spinner`,
    );

    check(
        'the outputs are still written, because setBusy is not a veto',
        busy.notifications() === 1 && busy.outputs().pressCount === 1,
        JSON.stringify(busy.outputs()),
    );

    /*
     * `setBusy` runs inside the handler, which runs inside `raise()`, which then
     * calls `notifyOutputChanged()` — and the platform answers that with an
     * `updateView`. Nothing the render writes may disturb the busy state.
     */
    busy.update({});

    check(
        'and a re-render leaves the busy state and the announcement alone',
        busy.button().disabled === true
            && busy.container.classList.contains('FormActionButton--busy')
            && busy.status() === 'Creating the invoice…',
        `${busy.status()} / disabled=${busy.button().disabled}`,
    );

    check(
        'a press while busy is ignored',
        (() => {
            busy.press();
            return busy.raised() === 1;
        })(),
        String(busy.raised()),
    );

    let answer;
    const answered = mount({ handler: (event) => { answer = event; event.setBusy(); } });

    answered.press();
    answer.setResult({ ok: true });

    check(
        'setResult() releases the button and reports',
        answered.button().disabled === false
            && !answered.container.classList.contains('FormActionButton--busy')
            && answered.status() === 'resx:FormActionButton_Done',
        answered.status(),
    );

    let failure;
    const failed = mount({ handler: (event) => { failure = event; event.setBusy(); } });

    failed.press();
    failure.setResult({ ok: false, message: 'The invoice already exists.' });

    check(
        'a failure is shown as a failure, in the handler’s own words',
        failed.status() === 'The invoice already exists.'
            && failed.container.classList.contains('FormActionButton--error'),
        failed.status(),
    );

    /*
     * The watchdog. `setBusy()` and `setResult()` are two calls in somebody
     * else's web resource, and the pair that is easy to write is the one whose
     * `catch` path forgets the second — which otherwise leaves a permanently
     * dead button on a form, with nothing on screen saying why.
     */
    const stalled = mount({ handler: (event) => event.setBusy() });

    stalled.press();
    time.advance(61000);

    check(
        'a handler that never reports back releases the button rather than dying busy',
        stalled.button().disabled === false && stalled.status() === 'resx:FormActionButton_Stalled',
        stalled.status(),
    );

    /*
     * The latch. An async handler closes over its payload by construction, and a
     * second press while the first is still running is one click — so a callback
     * from press 1 arriving after press 2 is an ordinary thing rather than an
     * edge case, and it must not drive the button.
     */
    const staleEvents = [];
    const stale = mount({ handler: (event) => staleEvents.push(event) });

    stale.press();
    staleEvents[0].setResult({ ok: true });
    stale.press();
    staleEvents[0].setBusy('from the press before last');

    check(
        'a callback from a superseded press is ignored',
        !stale.container.classList.contains('FormActionButton--busy')
            && stale.caption() === 'Submit',
        `${stale.caption()} / busy=${stale.container.classList.contains('FormActionButton--busy')}`,
    );

    /* ------------------------------------------------ record and privilege */

    const onRecord = mount({
        contextInfo: { entityId: '0f8fad5b-d9cb-469f-a165-70867728950e', entityTypeName: 'account' },
    });

    onRecord.press();

    check(
        'the payload names the record when the host publishes one',
        onRecord.payloads()[0].entityTypeName === 'account'
            && onRecord.payloads()[0].entityId === '0f8fad5b-d9cb-469f-a165-70867728950e',
        JSON.stringify({
            entityTypeName: onRecord.payloads()[0].entityTypeName,
            entityId: onRecord.payloads()[0].entityId,
        }),
    );

    check(
        'and leaves both out rather than inventing them where it does not',
        plain.payloads().length === 0 && mount({}).payloads().length === 0
            && (() => {
                const anonymous = mount({});
                anonymous.press();
                return anonymous.payloads()[0].entityTypeName === undefined
                    && anonymous.payloads()[0].entityId === undefined;
            })(),
    );

    /*
     * `contextInfo` is undocumented and untyped, so its contents are not
     * something to hand to a platform API unexamined. A value that cannot be a
     * logical name is dropped rather than passed on.
     */
    const bogus = mount({
        contextInfo: { entityId: 'x', entityTypeName: 'Account; DROP' },
        inputs: { requirePrivilege: 'write' },
    });

    bogus.press();

    check(
        'an entityTypeName that cannot be a logical name is dropped, not forwarded',
        bogus.payloads()[0].entityTypeName === undefined
            && !bogus.calls().some((call) => call.indexOf('utils.hasEntityPrivilege') === 0),
        bogus.calls().join(' → '),
    );

    const allowed = mount({
        contextInfo: { entityId: 'a', entityTypeName: 'account' },
        inputs: { requirePrivilege: 'delete' },
    });

    check(
        'asks for the privilege the maker chose, as the numeric enum the API wants',
        allowed.calls().some(
            (call) => call === 'utils.hasEntityPrivilege('
                + JSON.stringify({ entityTypeName: 'account', privilegeType: 4, privilegeDepth: 0 })
                + ')',
        ),
        allowed.calls().filter((call) => call.indexOf('utils.hasEntityPrivilege') === 0).join(' | '),
    );

    check('and leaves the button usable when the answer is yes', allowed.button().disabled === false);

    const denied = mount({
        hasPrivilege: false,
        contextInfo: { entityId: 'a', entityTypeName: 'account' },
        inputs: { requirePrivilege: 'delete' },
    });

    check('a missing privilege disables the button by default', denied.button().disabled === true);

    denied.press();

    check(
        'and the handler refuses the press too, not only the DOM',
        denied.raised() === 0 && denied.notifications() === 0,
        String(denied.raised()),
    );

    const hidden = mount({
        hasPrivilege: false,
        contextInfo: { entityId: 'a', entityTypeName: 'account' },
        inputs: { requirePrivilege: 'delete', privilegeDenied: 'hide' },
    });

    check(
        'and hides it instead where the maker asked for that',
        hidden.container.classList.contains('FormActionButton--hidden'),
    );

    /*
     * **Every way of not knowing answers yes.** `context.utils` is absent in
     * canvas and on any host without the `Utility` feature. A control that hid
     * itself there would go missing for reasons that have nothing to do with the
     * user's roles, and nothing on screen would say so.
     */
    const cannotAsk = mount({
        utils: false,
        contextInfo: { entityId: 'a', entityTypeName: 'account' },
        inputs: { requirePrivilege: 'delete' },
    });

    check(
        'a host that cannot answer the privilege question does not gate the button',
        cannotAsk.button().disabled === false,
    );

    const noRecord = mount({ utils: true, inputs: { requirePrivilege: 'delete' } });

    check(
        'and neither does a host that will not say which record this is',
        noRecord.button().disabled === false
            && !noRecord.calls().some((call) => call.indexOf('utils.hasEntityPrivilege') === 0),
    );

    check(
        'requirePrivilege "none" asks nothing at all',
        !mount({ contextInfo: { entityId: 'a', entityTypeName: 'account' } })
            .calls()
            .some((call) => call.indexOf('utils.hasEntityPrivilege') === 0),
    );

    /* ------------------------------------------------------- the host says no */

    const off = mount({ disabled: true });

    off.press();

    check(
        'a disabled form refuses the press in the handler, not only through the DOM',
        off.raised() === 0 && off.button().disabled === true,
    );

    check(
        'renders nothing visible when the host says it is hidden',
        mount({ visible: false }).container.classList.contains('FormActionButton--hidden'),
    );

    /* ----------------------------------------------------------- the theme */

    check(
        'takes no position on the theme where the host publishes none',
        !mount({ host: 'canvas' }).container.classList.contains('FormActionButton--dark'),
    );

    check(
        'and follows the form’s own theme where it does',
        mount({ dark: true }).container.classList.contains('FormActionButton--dark'),
    );

    check(
        'writes the direction on its own root, so the stylesheet can select on it',
        mount({ rtl: true }).container.dir === 'rtl',
        mount({ rtl: true }).container.dir,
    );

    /* ---------------------------------------------------- what destroy owes */

    /*
     * `destroy` is the lifecycle method with nothing visible riding on it, so it
     * is the one that quietly does nothing. This control takes two timers and
     * three listeners, and hands out three callbacks that write to its DOM — a
     * form left open all afternoon accumulates every one of them.
     *
     * Counting before and after is the whole trick.
     */
    disposeAll();

    const timersBefore = time.pending();
    const listenersBefore = Object.values(dom.document.listeners).reduce(
        (total, list) => total + list.length,
        0,
    );

    const disposable = mount({ dialogs: 'absent', inputs: { confirmRequired: true } });

    disposable.press();

    check(
        'an armed confirmation really is holding a timer',
        time.pending() === timersBefore + 1,
        `${timersBefore} → ${time.pending()}`,
    );

    disposable.destroy();

    check(
        'destroy() releases every timer the control took',
        time.pending() === timersBefore,
        `${timersBefore} → ${time.pending()}`,
    );

    check(
        'and every document-level listener',
        Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0)
            === listenersBefore,
        `${listenersBefore} → ${Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0)}`,
    );

    /*
     * The busy watchdog is the second timer, and it is the one a handler holding
     * a callback across a form navigation would otherwise leave behind.
     */
    let orphan;
    const abandoned = mount({ handler: (event) => { orphan = event; event.setBusy(); } });

    abandoned.press();
    abandoned.destroy();

    check(
        'destroy() releases the busy watchdog as well',
        time.pending() === timersBefore,
        `${timersBefore} → ${time.pending()}`,
    );

    check(
        'and a callback held across the teardown writes nothing into a detached control',
        (() => {
            orphan.setResult({ ok: false, message: 'too late' });
            return abandoned.container.querySelector('.FormActionButton-status').textContent
                === 'resx:FormActionButton_Busy';
        })(),
        abandoned.container.querySelector('.FormActionButton-status').textContent,
    );

    /*
     * The other half, and the leak this shape is famous for. `updateView` runs
     * on every change to any bound value, so a timer taken from the render path
     * adds one per render rather than replacing one.
     */
    const rerendered = mount({});
    const afterFirst = time.pending();

    rerendered.update({});
    rerendered.update({});
    rerendered.update({});

    check(
        'and re-rendering does not add another one',
        time.pending() === afterFirst,
        `${afterFirst} → ${time.pending()}`,
    );

    disposeAll();
}

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real form still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
