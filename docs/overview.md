---
title: Overview
description: A button for a model-driven form that hands the press to your form script — with a confirmation, a busy state, and an answer.
order: 1
---

# Form Action Button

A button you put on a model-driven form. Pressing it raises an event your form
script handles, and your handler can answer: veto the press, say it is working,
or report that it failed.

:::callout{type=warning}
**Reference example · built with AI.** This control was written with AI (Claude) and tested on a live Dataverse form; its code has not been reviewed line by line. It is published as a worked example and is not maintained — read the source and [SPEC.md](https://github.com/pcfhub/pcf-form-action-button/blob/main/SPEC.md) (what was measured on the form) before you use it. Fixes are not guaranteed.
:::

::image{src=media/screenshot-busy.png alt="The button disabled with a spinner in place of its glyph, still reading Approve, and the line Submitting for approval… underneath" zoom}

**Model-driven apps only.** For a button in a canvas app, use
[Action Button](https://pcfhub.dev/components/pcf-action-button) — the same idea
with Power Fx behind it instead of JavaScript.

## What it is for

Model-driven forms have a command bar, and the command bar is the right answer
for most buttons. This one is for the times it is not:

- **The button belongs next to a field**, not at the top of the form. A *Check
  address* beside the address, a *Recalculate* beside the total.
- **The button belongs to a section or a tab** that is only sometimes shown.
- **You want a confirmation and a busy state without writing them**, twice, in
  every command.

## What it does

- **Raises an event your script handles.** `addEventHandler("onAction", fn)`,
  with a payload carrying which press this was and which record it happened on.
- **Confirms before acting**, with the platform's own dialog. Where the host has
  no dialog it falls back to an inline two-step: the first press arms the button
  and turns it red, the second acts, and it reverts itself after four seconds.

  ::image{src=media/screenshot-armed.png alt="The button in its armed state: a red outline on a pale red fill, reading Delete permanently, with Press again to confirm, or press Escape to cancel underneath" zoom}

- **Lets your handler answer.** `preventDefault()` to make the press not count,
  `setBusy()` while a round trip runs, `setResult()` to say how it went — shown
  under the button and announced to a screen reader.

  ::image{src=media/screenshot-dark.png alt="On a dark form, the button back to normal with a failure message underneath in red: That invoice has already been submitted." zoom}

- **Gates on a privilege.** Ask for Delete on this table, and a user without it
  sees the button disabled, or not at all.
- **Reaches business rules and workflows too**, optionally, by writing a short
  signal into the column it is bound to.

## What it is not

It does not call Dataverse. Your handler already has `Xrm.WebApi`, the user's
context, and `formContext` — everything this control cannot have, because a code
component is expected to run where there is no form. This control's job is to
get the press to your handler cleanly, and to look right doing it.

It does not decide what the button does. There is no *action* property, no
formula, no URL. What happens is your script.

## Getting there

- [Installation](installation) — importing it, putting it on a column, and
  registering the handler.
- [Model-driven apps](model-driven) — the three channels and the payload
  contract. Read this one.
- [API reference](api) — every property.
- [Limitations](limitations) — what it will not do, and what is still preview.
