/*
 * The driver: wires the switches on `harness.html` to a real instance of the
 * control, models the round trip the platform makes after `notifyOutputChanged`,
 * and stands in for the one thing this control exists to talk to — a form
 * script registered with `addEventHandler("onAction", fn)`.
 *
 * Loaded before the control bundle, because the bundle registers itself the
 * moment it loads and needs somewhere to register. The page calls
 * `window.__harnessStart()` once the bundle has run.
 *
 * Read `harness.html` first — it says what this is for and what it is not.
 */

(function () {
    'use strict';

    var host = window.__pcfHost;
    var registration = host.captureRegistration(window);

    /** The platform's copy of the column, which is not the control's copy. */
    var columnValue = host.DEFAULTS.value;

    var instance = null;
    var container = null;
    var notifications = 0;

    /** Every platform call the control made, in order. */
    var calls = [];

    /** Every payload the control raised, newest last. */
    var payloads = [];

    /**
     * How long the simulated form script takes to answer.
     *
     * Two seconds rather than something instant, because the whole point of
     * `setBusy` is the gap: a handler that answers in the same tick would never
     * show the busy state that the gap exists to explain.
     */
    var HANDLER_DELAY_MS = 2000;

    /**
     * The form script, standing in for a web resource.
     *
     * Each branch is a shape somebody really writes, and three of the six are
     * mistakes worth seeing from the user's side rather than from a code review:
     * a handler that throws, one that vetoes without saying so, and one that
     * goes busy and forgets to report back.
     */
    function handle(payload) {
        payloads.push({
            at: new Date().toISOString().slice(11, 19),
            action: payload.action,
            pressCount: payload.pressCount,
            label: payload.label,
            entityTypeName: payload.entityTypeName,
            entityId: payload.entityId,
        });

        showPayloads();

        var behaviour = document.getElementById('harness-handler').value;

        if (behaviour === 'throw') {
            throw new Error('the form script is broken');
        }

        if (behaviour === 'veto') {
            payload.preventDefault();
            return;
        }

        if (behaviour === 'busy' || behaviour === 'fail' || behaviour === 'stall') {
            payload.setBusy();
        }

        if (behaviour === 'busy') {
            window.setTimeout(function () {
                payload.setResult({ ok: true, message: 'Created invoice INV-1042.' });
            }, HANDLER_DELAY_MS);
        }

        if (behaviour === 'fail') {
            window.setTimeout(function () {
                payload.setResult({ ok: false, message: 'That invoice already exists.' });
            }, HANDLER_DELAY_MS);
        }
    }

    function options() {
        var events = document.getElementById('harness-events').checked ? { onAction: handle } : null;

        return {
            host: document.getElementById('harness-host').value,
            formFactor: document.getElementById('harness-formfactor').value,
            width: Number(document.getElementById('harness-width').value),
            calls: calls,
            value: columnValue,
            events: events,
            disabled: document.getElementById('harness-disabled').checked,
            visible: document.getElementById('harness-visible').checked,
            dark: document.getElementById('harness-dark').checked,
            rtl: document.getElementById('harness-rtl').checked,
            contextInfo:
                document.getElementById('harness-identity').value === 'contextinfo'
                    ? { entityId: '0f8fad5b-d9cb-469f-a165-70867728950e', entityTypeName: 'account' }
                    : null,
            utils: document.getElementById('harness-utils').checked,
            hasPrivilege: document.getElementById('harness-privilege').checked,
            hasNavigation: document.getElementById('harness-navigation').checked,
            dialogs: document.getElementById('harness-dialogs').value,

            /*
             * The control's own manifest properties. Every one is stated, so the
             * page never leaves one `undefined` — the platform hands a declared
             * `default-value` down as a real value, and a control read against
             * `undefined` is being tested on a host that does not exist.
             */
            inputs: {
                label: document.getElementById('harness-label').value,
                icon: document.getElementById('harness-icon').value,
                confirmRequired: document.getElementById('harness-confirm').checked,
                confirmTitle: '',
                confirmText: document.getElementById('harness-confirmtext').value,
                confirmButtonLabel: document.getElementById('harness-confirmbutton').value,
                writeSignal: document.getElementById('harness-writesignal').checked,
                requirePrivilege: document.getElementById('harness-requireprivilege').value,
                privilegeDenied: document.getElementById('harness-privilegedenied').value,
            },
        };
    }

    /*
     * What the platform does after a control says its outputs changed.
     *
     * It reads `getOutputs()`, keeps the answer as the column's new value, and
     * comes back through `updateView` with it. Modelling that round trip is most
     * of the value of this page — and for this control it is what shows the
     * anchor column staying exactly as it was while `writeSignal` is off.
     *
     * Deferred rather than immediate, because the platform is asynchronous and
     * because calling back synchronously from inside the control's own click
     * handler would re-enter it mid-press — a shape the platform never produces,
     * so a bug found that way would not be a real one.
     *
     * **`undefined` means "no change".** The guard is on the key being present
     * rather than on the value being truthy, because those are different
     * questions and this control depends on the difference.
     */
    function notifyOutputChanged() {
        notifications += 1;

        window.setTimeout(function () {
            var outputs = instance.getOutputs ? instance.getOutputs() : {};

            if (Object.prototype.hasOwnProperty.call(outputs, 'signal') && outputs.signal !== undefined) {
                columnValue = outputs.signal;
                document.getElementById('harness-value').value =
                    outputs.signal === null ? '' : String(outputs.signal);
            }

            render();
        }, 0);
    }

    function render() {
        var context = host.createContext(options());

        instance.updateView(context);

        var form = document.getElementById('harness-form');
        form.classList.toggle('is-dark', document.getElementById('harness-dark').checked);
        form.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';

        document.getElementById('harness-formlabel').textContent = context.mode.label;

        showOutputs();
    }

    /*
     * `getOutputs()` printed as it actually is, with an absent key spelled out.
     *
     * `JSON.stringify` drops `undefined` entirely and prints nothing at all for
     * a key that was never set, which for this control hides the guarantee that
     * matters most — that with `writeSignal` off, `signal` is *not there*.
     */
    function showOutputs() {
        var outputs = instance.getOutputs ? instance.getOutputs() : {};
        var lines = Object.keys(outputs).map(function (key) {
            var value = outputs[key];
            var shown;

            if (value === undefined) {
                shown = 'undefined   <- the platform reads this as "no change"';
            } else if (value === null) {
                shown = 'null        <- an explicit clear';
            } else {
                shown = JSON.stringify(value);
            }

            return '  ' + key + ': ' + shown;
        });

        if (!Object.prototype.hasOwnProperty.call(outputs, 'signal')) {
            lines.push('  signal: absent      <- the bound column is left exactly as it was');
        }

        document.getElementById('harness-outputs').textContent =
            lines.length > 0 ? '{\n' + lines.join('\n') + '\n}' : '{}';

        document.getElementById('harness-notified').textContent =
            'notifyOutputChanged x' + notifications
            + (calls.some(function (call) { return call.indexOf('trackContainerResize') === 0; })
                ? ' · trackContainerResize called'
                : ' · never asked to be resized');
    }

    function showPayloads() {
        document.getElementById('harness-raised').textContent = 'onAction x' + payloads.length;

        document.getElementById('harness-payloads').textContent =
            payloads.length === 0
                ? 'Nothing yet. Press the button.'
                : payloads
                    .slice(-8)
                    .map(function (entry) {
                        return JSON.stringify(entry);
                    })
                    .join('\n');
    }

    window.__harnessStart = function () {
        var status = document.getElementById('harness-status');

        if (typeof registration.ctor !== 'function') {
            status.textContent = 'No control registered — run npm run build, then reload.';

            return;
        }

        var context = host.createContext(options());

        container = document.getElementById('harness-root');
        instance = new registration.ctor();

        instance.init(context, notifyOutputChanged, {}, container);

        var returned = instance.updateView(context);

        if (returned !== undefined) {
            status.textContent =
                'updateView returned a value — this is a virtual control, and this page cannot render one. Use npm start and npm run smoke.';

            return;
        }

        document.getElementById('harness-value').value = columnValue === null ? '' : String(columnValue);

        /*
         * One delegated listener, not a list of ids.
         *
         * This was a hand-maintained array upstream, and the array is the bug: a
         * switch added to `harness.html` and to `options()` but forgotten here
         * renders perfectly, reads correctly, and never triggers an update — so
         * it appears to do nothing, or worse, appears to work the moment any
         * *other* switch is touched.
         *
         * Delegating to the panel covers every control in it, including ones
         * added later, and `change` bubbles from `select` and `input` alike.
         */
        document.querySelector('.harness-controls').addEventListener('change', render);

        // Typing is a different event from committing, and the text switches
        // here are ones you want to see take effect as you type.
        document.querySelector('.harness-controls').addEventListener('input', function (event) {
            if (event.target.type === 'text' || event.target.type === 'number') {
                render();
            }
        });

        // Typed into the column, not into the control — this is the platform
        // handing down a new bound value.
        document.getElementById('harness-value').addEventListener('input', function (event) {
            columnValue = event.target.value;
        });

        /*
         * `null`, not `''`. A cleared column and an empty string are different
         * values, and a control that renders them the same way is usually fine
         * while one that *writes* them the same way is not.
         */
        document.getElementById('harness-clear').addEventListener('click', function () {
            columnValue = null;
            document.getElementById('harness-value').value = '';
            render();
        });

        // The cheapest way to catch work that belongs behind a comparison:
        // press it and watch whether anything moves.
        document.getElementById('harness-rerender').addEventListener('click', render);

        status.textContent = 'Registered ' + registration.name + '.';

        showPayloads();
        render();
    };
})();
