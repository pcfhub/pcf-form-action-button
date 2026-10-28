---
title: Model-driven apps
description: The three ways a press reaches a form script, and the contract the event payload carries.
order: 3
---

# Model-driven apps

This control has one job: turn a press into something that acts on it. Since
0.2.0 that can be **a Dataverse action the button calls itself**, so a flow or
a plug-in does the work with no form script at all — see
[Call an action](#call-an-action-no-script). Without one, the press reaches your
form script three ways, all at once, because each one is missing on some host or
in some setup.

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

## Call an action, no script

Fill in **Action name** and every press that commits calls that Dataverse
action — your own Custom API, or one of the platform's messages — after the
event and the outputs. Leave it empty and the button is exactly what it was in
0.1.0.

| Property | What to put there |
| --- | --- |
| **Action name** | The action's unique name, exactly as written: the server is case-sensitive, and `contoso_Approve` is not `contoso_approve`. |
| **Action binding** | **Bound to this record** (the default) calls it on the record the form shows. **Unbound** calls it on its own. |
| **Action parameters** | Optional. The parameters as JSON — `{"Reason": "From the form"}` — or the name of a web resource holding them, because a form keeps only 100 characters here. `{id}` anywhere in text becomes the record's id; a value of exactly `"{record}"` becomes a reference to the record. |
| **Result property** | Optional. A response property of the action; its value is what the button says afterwards. |

While the call runs the button is busy — a spinner, and *Running…* underneath.
Then it says how it went:

- the **result property's** value, when you named one and the action returned it;
- **Sent.** when the action has no response properties (it answers with nothing,
  which is what an action that only triggers a flow does);
- **Done.** for any other success;
- the **server's own sentence** for a refusal, in red — and, when the name is what
  it could not find, a reminder that names are case-sensitive and that bound and
  unbound are addressed differently.

A bound action needs a saved record. On a new one the button is off and says
*Save the record first.*; it comes on by itself after the first save, without a
reload. An unbound action whose parameters mention `{id}` or `{record}` waits
the same way.

### Running a flow from the button

Power Automate's Dataverse trigger **When an action is performed** runs a flow
whenever a Dataverse action runs. Point the button at one:

1. **Create a Custom API** in your solution — a message with nothing behind it
   is enough. Set **Binding type** to *Entity* and **Bound entity logical name**
   to your table (or *Global* for unbound), **Is function** to *No*, and
   **Allowed custom processing step type** to *Async only*. Add request
   parameters only if the flow needs values from the button.
2. **Catalog it.** The trigger only lists actions that are in a **catalog** and
   a **category** under it: create both, then a **catalog assignment** linking
   the category to your Custom API. (Learn: *Catalog and CatalogAssignment
   tables*.)
3. **Build the flow** with **When an action is performed**: your catalog, your
   category, the table (or *(none)* for unbound) and the action.
4. **Put the action's unique name in Action name**, and pick the binding.

The button says **Sent.** as soon as Dataverse accepts the call — the flow runs
after that, on its own, and the button cannot see how it went. Measured on a
form: the call answered in about half a second, and the flow started between
half a second and five seconds after that.

**What the flow receives.** The trigger's body, from a press of a button bound
to an account, with a `Note` text parameter and a `Record` reference:

```json
{
  "InputParameters": {
    "Note": "from the form, 7de84297-…",
    "Record": { "Id": "7de84297-…", "LogicalName": "account", "Name": null, "KeyAttributes": [], "RowVersion": null },
    "Target": { "Id": "7de84297-…", "LogicalName": "account", "Name": null, "KeyAttributes": [], "RowVersion": null }
  },
  "OutputParameters": {},
  "ItemInternalId": "7de84297-…",
  "SdkMessage": "contoso_NotifyTeam",
  "RunAsSystemUserId": "eea5fa1a-…"
}
```

- Each parameter is under `InputParameters` by its own name — in the designer's
  dynamic content they are listed as *ActionInputs …*. In an expression:
  `triggerBody()?['InputParameters']?['Note']`.
- **The record the button sits on is `InputParameters.Target`** on a bound
  action, so the flow has it without a parameter:
  `triggerBody()?['InputParameters']?['Target']?['Id']`, or
  `triggerOutputs()?['body/ItemInternalId']`. An unbound action has neither.
- `RunAsSystemUserId` is the user who pressed — use it with *Get a row by ID* on
  **Users** to address them.

A flow's writes are not on the form when the button says *Sent.* — the flow has
not run yet. Refreshing on **Action status** (below) shows what a plug-in did,
not what a flow will do; have the flow tell the user, or let them refresh.

::callout{type=warning}
**A bound Custom API cannot have a parameter named `Target`.** Dataverse refuses
to create one (*Custom API bound to an entity cannot use the reserved name
'Target'*) because the bound record already is the action's `Target`. You do not
need to pass the record to a bound action at all; use another name for anything
else.
::

### The two outputs, and refreshing the form afterwards

| Output | Holds |
| --- | --- |
| **Action status** | `3|ok` or `3|failed` — the press it reports and how the call went, written when the answer arrives. The number is there so two calls that both succeed are still two changes. |
| **Action result** | The result property's value from the last call, or empty. |

The press writes **Press count** at once and **Action status** when the answer
arrives, a fraction of a second later — and the form may hand your
`addOnOutputChange` handler both in **one** event, carrying the final values.
Read the outputs you are given rather than counting events.

A plug-in behind the action can change the record, and the form will not show
it until it re-reads. Refresh it when the call reports back — measured on a form:
the new value appears in about a quarter of a second, the form stays clean, and
the button is not reloaded:

```javascript
this.onLoad = function (executionContext) {
    var formContext = executionContext.getFormContext();
    var control = formContext.getControl("contoso_actionanchor");

    control.addOnOutputChange(function () {
        var outputs = control.getOutputs();
        var status = outputs["contoso_actionanchor.fieldControl.actionStatus"];

        if (status && /\|ok$/.test(status.value)) {
            formContext.data.refresh(false);
        }
    });
};
```

`refresh(false)` on a form with unsaved changes asks the user about them first,
so save before calling an action that changes the record, or refresh only when
`formContext.data.entity.getIsDirty()` is false.

### With a script as well

The action and channel 1 work together. Your `onAction` handler runs first, and
`payload.preventDefault()` stops the call as well as the outputs — a check that
says no before anything is sent. `setBusy()` and `setResult()` do not apply to a
button with an action: the call shows its own progress and result, so the
control ignores them and says so in the console.

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

Makes the button unavailable, shows a spinner and says what is happening. Call
it for anything that takes a round trip. The button keeps keyboard focus while
it is busy — it ignores presses rather than being disabled — so a keyboard user
is still on it when the result arrives.

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
var control = formContext.getControl("contoso_actionanchor");

control.addOnOutputChange(function () {
    var outputs = control.getOutputs();

    console.log(
        outputs["contoso_actionanchor.fieldControl.pressCount"].value,
        outputs["contoso_actionanchor.fieldControl.lastAction"].value
    );
});
```

Two things in that are easy to get wrong, and the version of this page before
0.2.0 got both. **Read the outputs from the control**, not from the handler's
`executionContext.getEventSource()` — that is the *column*, which has no
`getOutputs`. And **each output is keyed by the column and the control**,
`"<column>.fieldControl.<output>"`, holding `{ type, value }`;
`outputs.pressCount` is `undefined`.

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

It calls Dataverse only when you name an action, and then only that action, as
the user, on the organisation the form is on. Everything else — reading and
writing records, saving, navigating — is your handler's, which already has
`Xrm.WebApi` and the user's own context.
