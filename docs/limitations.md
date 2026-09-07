---
title: Limitations
description: What this control will not do, and what is still preview.
order: 7
---

# Limitations

## Custom events are a preview feature

Microsoft's documentation for defining events in a code component is marked
*pre-release documentation and is subject to change*. The `onAction` event, and
therefore channel 1 in [Model-driven apps](model-driven), rests on it.

Everything here follows the published contract, and the control feature-detects
rather than assuming — a host that binds no event still produces a working button
through its outputs. But if you are building something you cannot afford to have
change under you, handle `addOnOutputChange` as well. It is three lines and it is
a stable API.

## Model-driven only

Canvas is not supported. The control would load there — it binds a column, which
canvas allows — but three things it depends on are simply absent: the
confirmation dialog, `context.utils` for the privilege check, and the record
identity in the event payload. What is left is a button that raises an event you
have no Power Fx binding for.

Use [Action Button](https://pcfhub.dev/components/pcf-action-button) in canvas
instead. It is built for that host and declares `OnSelect`.

Power Pages is not supported either, for the same reasons and one more: it does
not support `context.utils` at all.

## It does not talk to Dataverse

No `WebAPI` feature is declared and none is used. Your handler already has
`Xrm.WebApi` and the user's own context — see the worked example in
[Model-driven apps](model-driven).

## `preventDefault()` is synchronous only

Your handler runs inside the control's click path, and the outputs are written
the moment it returns. A `preventDefault()` from inside a `.then()` is about a
decision that has already been made: the control ignores it and logs a warning
rather than applying it to the next press.

If you cannot decide without asking the server, use `setBusy()` and report the
outcome with `setResult()` instead.

## A busy handler is released after 60 seconds

`setBusy()` and `setResult()` are two calls in your script, and the pair that is
easy to get wrong is the one whose failure path forgets the second. Rather than
leave a permanently dead button, the control releases it after 60 seconds and
says that nothing reported back.

That is a safety net, not a feature. A genuinely slow operation that crosses the
minute mark will look to the user as though it gave up. Put the `setResult()` in
a `finally`, or in both branches.

## `Press count` never resets

It counts presses of this control instance and starts at zero when the form
loads. There is no reset, and a handler cannot set it — that would make the
number something two parties write, and the whole reason it exists is to be a
number nobody else touches.

## The privilege check answers about roles, not about this record

`hasEntityPrivilege` asks whether the user has a privilege on the **table**. It
cannot answer whether they have it on *this row*, which is a question only the
server can settle. A user with Basic delete on a record somebody else owns sees
an enabled button and gets the server's refusal.

That is the honest place for the refusal to happen. The check is here to hide
commands from people who could never run them, not to replace the server's own
answer.

Where the host publishes no `context.utils` or no record identity, the check is
skipped entirely and the button stays enabled. See the note in the
[API reference](api).

## One handler per control instance

`addEventHandler` binds to a control, not to a form. Two of these buttons on one
form means two registrations. `payload.label` is there so one function can serve
both.

## The signal column is written, not appended

With **Write to the signal column** on, each press replaces the column's value.
There is no history — the column holds the most recent press and nothing else. If
you need a log, write one from your handler.
