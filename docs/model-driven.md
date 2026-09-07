---
title: Model-driven apps
description: The three ways a press reaches a form script, and the contract the event payload carries.
order: 3
---

# Model-driven apps

This control has one job: turn a press into something your form script can act
on. It does that three ways, and it does all three at once, because each one is
missing on some host or in some setup.

| | Channel | You write | The control needs |
| --- | --- | --- | --- |
| 1 | The `onAction` event | `control.addEventHandler("onAction", fn)` | nothing |
| 2 | The output properties | `control.addOnOutputChange(fn)` | nothing |
| 3 | The bound column | an `OnChange` handler, a business rule, a workflow | **Write to the signal column** switched on |

Channel 1 is the one to reach for. It is the only one that carries a payload,
and the only one your handler can answer.

::callout{type=info}
Custom events in code components are documented by Microsoft as a **preview**
feature. Everything on this page follows their published contract, but a preview
API can change. If you are shipping something you cannot afford to have break,
handle channel 2 as well — it is three extra lines and it is a stable API.
::

## Channel 1 — the `onAction` event

Register the handler in your form's **On Load**, and it will be called every time
the button is pressed and any confirmation has been given.

```javascript
"use strict";

var Contoso = window.Contoso || {};

(function () {
    // The logical name of the column you put the control on.
    var CONTROL = "contoso_actionanchor";

    this.onLoad = function (executionContext) {
        var formContext = executionContext.getFormContext();
        var control = formContext.getControl(CONTROL);

        if (!control) {
            return;
        }

        control.addEventHandler("onAction", this.onAction);
    };

    this.onAction = function (payload) {
        console.log(payload.action, payload.pressCount, payload.entityTypeName);
    };
}).call(Contoso);
```

Upload that as a JavaScript web resource, add it to the form's libraries, and
register `Contoso.onLoad` on the form's **On Load** event.
[docs/installation.md](installation) has the click-by-click version.

::callout{type=warning}
`addEventHandler` is bound **per control instance**. If you put two of these
buttons on one form, register a handler on each — and use `payload.label` to tell
them apart, or give each one its own handler function.
::

### What the payload carries

```javascript
{
    action: "press" | "confirm",
    pressCount: 4,
    label: "Send for approval",
    entityTypeName: "contoso_invoice",   // absent off a record
    entityId: "0f8fad5b-…",              // absent off a record

    preventDefault: function () {},
    setBusy: function (message) {},
    setResult: function (result) {}
}
```

| | |
| --- | --- |
| `action` | `"confirm"` when the user was asked and agreed, `"press"` when no confirmation was configured. |
| `pressCount` | The value the `Press count` output **will** hold if this press commits. A press you call `preventDefault()` on does not commit, so the same number arrives again on the next press. |
| `label` | The button's caption, so one handler can serve several buttons. |
| `entityTypeName`, `entityId` | Read from the form's own context. Both are absent where the host does not publish a record — a new record before its first save, and canvas. Check before using them. |

### Answering the control

The three functions are how your handler talks back. All three are **latched to
the press they came with**: if the user presses again, callbacks from the earlier
press stop doing anything. That is deliberate — an asynchronous handler closes
over its payload by construction, and a second press while the first is still
running is one click.

#### `preventDefault()`

Suppresses this press's outputs and its signal-column write. The event still
happened; the *record* of it does not. Use it when your handler decides the press
should not count — a validation that failed, a state the record is not in.

::callout{type=warning}
**It is synchronous only.** Your handler runs inside the control's own click
path, and the outputs are written the moment it returns. A call from inside a
`.then()` arrives after the decision has been made; the control ignores it and
writes a warning to the console rather than applying it to the next press.

Decide before you `await`. If you cannot decide without asking the server, use
`setBusy()` and report the outcome with `setResult()` instead.
::

#### `setBusy(message)`

Disables the button, shows a spinner and says what is happening. Call it for
anything that takes a round trip.

`message` is optional; leave it out for a localised "Working…".

#### `setResult({ ok, message })`

Clears busy and reports. `ok: false` shows the message as a failure, in red,
under the button. `message` is optional in both cases and falls back to a
localised "Done." or "The action did not complete."

::callout{type=warning}
A handler that calls `setBusy()` and never calls `setResult()` would leave a
permanently dead button, so the control releases it after **60 seconds** and says
that nothing reported back. That is a safety net, not a feature — put the
`setResult()` in a `finally`, or in both branches of your `then`/`catch`.
::

### A worked example

Confirm, then do the work, then say how it went:

```javascript
this.onAction = function (payload) {
    if (payload.action !== "confirm") {
        return;
    }

    if (!payload.entityId) {
        // Nothing has been saved yet, so there is no record to act on.
        payload.preventDefault();
        Xrm.Navigation.openAlertDialog({ text: "Save the record first." });
        return;
    }

    payload.setBusy("Submitting for approval…");

    Xrm.WebApi.updateRecord(payload.entityTypeName, payload.entityId, {
        contoso_status: 2
    }).then(
        function () {
            payload.setResult({ ok: true, message: "Sent for approval." });
        },
        function (error) {
            payload.setResult({ ok: false, message: error.message });
        }
    );
};
```

Two things in that example are worth copying rather than the rest. It checks
`entityId` before using it, because a brand-new record has none. And it answers
on **both** paths of the promise, so the button comes back either way.

## Channel 2 — the output properties

The control writes two outputs on every press that commits. A form script reads
them with the standard Client API, no custom event involved:

```javascript
control.addOnOutputChange(function (executionContext) {
    var outputs = executionContext.getEventSource().getOutputs();

    console.log(outputs.pressCount.value, outputs.lastAction.value);
});
```

`Press count` exists precisely so this channel works twice. `OnOutputChange`
fires on a **change**, not on a write — so two consecutive confirmed presses both
setting `Last action` to `"confirm"` would be one event and one silence without a
number that moves.

Use this channel when you want a stable, non-preview API, or when you want one
place to watch several controls' outputs.

## Channel 3 — the bound column

Switch **Write to the signal column** on and every committed press writes a short
string into the column the control is bound to:

```text
press|4
confirm|5
```

That fires the column's own `OnChange` event, which is the route Microsoft's own
FAQ recommends for getting from a code component to `formContext`. It also
reaches things that are not JavaScript at all — business rules, and real-time
workflows on update.

The count is in the string on purpose. A column set to the same value twice fires
no `OnChange`, which is the same trap `Press count` exists for.

::callout{type=warning}
**Bind a column that exists for this.** With the switch off — the default — the
control never writes the column, so binding it to a live business field is safe.
With the switch on, it writes on every press, and a business field would be
overwritten and saved.

If you use this channel, either add a dedicated text column, or keep the column
out of the save:

```javascript
formContext.getAttribute("contoso_actionanchor").setSubmitMode("never");
```
::

## Choosing between them

- **Just do a thing when I press it** → channel 1.
- **My handler needs to say wait, or say it failed** → channel 1. It is the only
  one that goes both ways.
- **I do not want to depend on a preview API** → channel 2.
- **A business rule or a workflow has to see it, not a script** → channel 3.

Nothing stops you using more than one. Do note that if you handle channel 1 *and*
watch channel 2, one press reaches your code twice — which is fine when they do
different jobs and a bug when they do the same one.

## What this control does not do

It never touches `formContext`. Code components cannot: they are expected to run
on hosts where there is no form, so the framework does not hand one over. That is
the whole reason the three channels exist — your handler has `formContext`, and
the control hands the press to your handler.

It also never calls Dataverse. Your handler already has `Xrm.WebApi` and the
user's own context; a control that made the call itself would need the `WebAPI`
feature, which is an install-time permission prompt for something you can already
do better.
