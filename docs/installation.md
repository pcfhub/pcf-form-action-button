---
title: Installation
description: Import the solution, put the control on a column, and register the handler that makes it do something.
order: 2
---

# Installation

<!--
  Do not link to the release assets by hand. The hub serves the managed and
  unmanaged downloads for the version the reader is viewing, and a hard-coded
  link goes stale on the next release.
-->

## 1. Import the solution

:::steps
1. Download the **managed** solution for your environment.
2. In the Power Platform admin centre, import the solution.
3. Publish all customizations.
:::

::callout{type=warning}
Import the managed solution into production. The unmanaged one is for a
development environment where you intend to change the control itself — it
cannot be cleanly uninstalled.
::

## 2. Pick the column the button sits on

A model-driven form hosts a code component **on a column**, so the button needs
one to sit on. It is an anchor, not data: out of the box the control never writes
it, so it is safe to point at any single-line-of-text column on the table.

If you have nothing suitable, add a text column named for the job —
`contoso_actionanchor` is the sort of name that saves an argument later.

::callout{type=info}
If you plan to switch **Write to the signal column** on, do not point this at a
business field. That switch makes every press write into the column, and the
write is saved with the record. Use a dedicated column, or keep it out of the
save — step 4 has the line.
::

## 3. Add the control to the column

:::steps
1. Open the table's form in the form designer.
2. Put the column on the form, then select it.
3. In the properties pane, open **Components** and choose **+ Component**.
4. Pick **Form Action Button**.
5. Tick the form factors it should appear on: **Web**, **Phone**, **Tablet**.
6. Set the **Label**, and anything else from the
   [API reference](api).
7. Save and publish.
:::

Hiding the column's own label is usually what you want — a button does not need a
field label above it. That is **Hide label** in the column's Display options, not
a property of this control.

## 4. Register the handler

**A button with no handler does nothing, and nothing warns you.** This is the
step that gets skipped.

Create a JavaScript web resource:

```javascript
"use strict";

var Contoso = window.Contoso || {};

(function () {
    var CONTROL = "contoso_actionanchor";

    this.onLoad = function (executionContext) {
        var formContext = executionContext.getFormContext();
        var control = formContext.getControl(CONTROL);

        if (!control) {
            return;
        }

        // Only if you switched "Write to the signal column" on: keeps the
        // control's writes out of the saved record.
        // formContext.getAttribute(CONTROL).setSubmitMode("never");

        control.addEventHandler("onAction", this.onAction);
    };

    this.onAction = function (payload) {
        Xrm.Navigation.openAlertDialog({
            text: "Pressed " + payload.pressCount + " time(s)."
        });
    };
}).call(Contoso);
```

:::steps
1. In your solution, add a **JavaScript web resource** and upload the file.
2. Open the form designer, go to the form's **Events** tab.
3. Under **Form Libraries**, add the web resource.
4. Under **Event Handlers**, add a handler on **On Load**:
   - Library: your web resource
   - Function: `Contoso.onLoad`
   - **Pass execution context as first parameter**: ticked.
5. Save and publish.
:::

Then open a record and press the button. The alert confirms the whole chain
works; replace `onAction` with the real thing from
[Model-driven apps](model-driven).

::callout{type=warning}
**Pass execution context as first parameter** is a checkbox that is off by
default, and without it `executionContext.getFormContext` is not a function. It
is the single most common reason step 4 appears not to work.
::

## Requirements

- A model-driven app. Canvas is not supported — see
  [Limitations](limitations).
- Nothing else. The control declares one optional feature, `Utility`, which it
  uses only when you ask for a privilege check; it degrades rather than failing
  where the host has none.
