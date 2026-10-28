---
title: API reference
description: Properties and outputs, generated from the control manifest.
order: 5
---

# API reference

<!--
  Do not write the property tables by hand.

  `props-table` renders from what the hub parsed out of
  ControlManifest.Input.xml at the release being viewed, so it cannot drift from
  the control.
-->

## Input properties

::props-table{kind=input}

## Bound properties

::props-table{kind=bound}

## Outputs

::props-table{kind=output}

## The event

The manifest declares one custom event, `onAction`. It carries no display name
into this reference, so it is documented here instead — and in full, with the
payload contract, in [Model-driven apps](model-driven).

```javascript
formContext.getControl("<column>").addEventHandler("onAction", function (payload) { … });
```

## Notes

**`Require a privilege`** maps to Dataverse's own privilege types, asked at
**Basic** depth. Dataverse resolves depth upwards, so a user with Deep or Global
also answers yes to a Basic question — asking for Basic is asking "may this user
do it at all", which is the question a button is about.

The check needs two things the host does not always publish: `context.utils`,
which is model-driven only, and the record's identity. **Where either is missing
the control does not gate.** A button that hid itself because it could not ask
would go missing for a reason nothing on screen explains; letting the press
through leaves the server to refuse, which at least produces a message.

**`Write to the signal column`** writes `press|4` or `confirm|5` — the action,
then the press number. The number is there so two identical presses are two
different values: a column set to the same value twice fires no `OnChange`.

**`Confirmation button`** does double duty. It is the affirmative button in the
platform's dialog, and it is the caption the button wears while an inline
confirmation is armed. `Confirmation message` is only ever the dialog's body —
a sentence long enough to be a good question is too long to be a good button.

**`Press count`** never resets within a form session. It counts presses of this
control instance, starting at zero when the form loads.

**`Action name`** (since 0.2.0) is kept exactly as written — Dataverse is
case-sensitive about action names, and a name in another case is a *not found*.
A name with a space or a symbol in it is refused before any call, with the
button off and the reason under it. Empty means no action: the 0.1.0 button.

**`Action parameters`** is one JSON object, `{"Name": value}`, or the name of a
web resource holding one. It is read when the button is first pressed, not when
the form loads; a web resource that is missing is asked for again on the next
press, so publishing a fix needs no reload. `"{record}"` must be a whole value —
inside other text it is refused, because it becomes an object, not a string.

**`Action status`** is `<press count>|ok` or `<press count>|failed`, and
**`Action result`** the result property's value or empty. Both start empty and
are written when the call answers, after `Press count`, which the press itself
wrote. Read them from the control — `getOutputs()` keys each one as
`"<column>.fieldControl.actionStatus"`; see
[Model-driven apps](model-driven#the-two-outputs-and-refreshing-the-form-afterwards).
