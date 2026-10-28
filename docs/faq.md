---
title: FAQ
description: The questions this control gets asked before somebody reads the rest of the docs.
order: 8
---

# FAQ

## I pressed it and nothing happened.

Almost always one of three things, in this order:

1. **No handler is registered.** A button with nothing bound to its event does
   exactly nothing and warns about nothing. Work through step 4 of
   [Installation](installation) and start with the alert.
2. **The execution context is not being passed.** In the form's event handler
   registration, **Pass execution context as first parameter** is a checkbox that
   is off by default, and without it `executionContext.getFormContext` is not a
   function — so your `onLoad` throws before it registers anything.
3. **The column name is wrong.** `formContext.getControl("…")` takes the
   column's logical name, and returns `null` for a name that is not on the form.

## Why does it need a column at all? It is a button.

Because a model-driven form hosts a code component *on* a column — that is how
the form designer offers components, and there is no other way to place a field
component. The column is an anchor.

The control does not write it unless you ask it to, so any single-line-of-text
column will do. See step 2 of [Installation](installation).

## Can I use it in a canvas app?

No. Use [Action Button](https://pcfhub.dev/components/pcf-action-button), which
is the canvas version of the same idea with an `OnSelect` you can put Power Fx
in. [Limitations](limitations) says what is missing in canvas and why.

## Why not just use a command bar button?

Often you should. The command bar is the platform's own answer, it is more
discoverable, and it does not need a column.

Reach for this one when the button belongs *next to something* — beside the field
it acts on, inside a section that is only sometimes visible — or when you want a
confirmation, a busy state and a result line without writing those three things
into every command.

## Can the handler stop the press?

Yes, `payload.preventDefault()`. It suppresses the outputs and the signal write,
so nothing downstream sees a press that did not happen.

It has to be called **synchronously**, before your handler returns. If the
decision needs a round trip, use `setBusy()` and report with `setResult()`
instead. [Limitations](limitations) has the reasoning.

## The button is stuck showing "Working…".

Your handler called `setBusy()` and never called `setResult()`. The control
releases the button after 60 seconds and says so, but the fix is in the script:
call `setResult()` in a `finally`, or in both branches of your `then`/`catch`.

## Can I make it do something without writing any JavaScript?

Yes, since 0.2.0. Put a Dataverse action's name in **Action name** and the
button calls it — then a **Power Automate flow** on *When an action is
performed*, or a plug-in, does the work. The steps, including the catalog the
flow trigger needs, are in
[Model-driven apps](model-driven#running-a-flow-from-the-button).

Without an action there is still one script-free route: switch **Write to the
signal column** on and bind it to a dedicated text column — every press writes a
value there, which a **business rule** or a **real-time workflow on update** can
react to. The last example in [Examples](examples) shows it.

## It says "Sent." — did my flow run?

*Sent.* means Dataverse accepted the call. A flow on *When an action is
performed* runs after that, on its own, and the button cannot see it; look in
the flow's run history. An action with a plug-in behind it can answer instead —
name its response property in **Result property** and the button says what it
returned.

## Creating my Custom API failed on a parameter called `Target`.

A bound Custom API cannot have one: the record it is bound to already is its
`Target`. The flow gets the record from the trigger — as
`InputParameters.Target` — so you do not need to pass it; call any other
parameter something else.

## Does it save the record?

No. It does not save, refresh, or navigate. If your handler changes fields, the
form goes dirty and the user saves — or your handler calls
`formContext.data.save()` itself. An action the button calls sees the record as
it was last saved, so save first if the flow needs what was just typed.

## Why are there two outputs?

`Last action` says *what* happened; `Press count` says that it happened *again*.
`OnOutputChange` and a column's `OnChange` both fire on a change, not on a write
— so two consecutive confirmed presses would be one event and one silence without
a number that moves.

## Can I have more than one on a form?

Yes. Each needs its own column and its own `addEventHandler` call —
`addEventHandler` binds to a control, not to a form. `payload.label` is there so
one function can serve several buttons; there is an example in
[Examples](examples).

## Will the user see the button if they are not allowed to do the thing?

Only if you tell it to check. Set **Require a privilege** to the privilege the
action needs, and the button is disabled — or hidden, your choice — for a user
without it.

It is a table-level check, not a row-level one, and it is skipped entirely on a
host that cannot answer. Both caveats are in [Limitations](limitations).
