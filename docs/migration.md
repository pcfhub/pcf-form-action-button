---
title: Migrating to 0.2.0
description: Nothing breaks — and the 0.1.0 snippet for reading the outputs never worked; here is the one that does.
appliesTo: ">=0.2.0"
order: 9
---

# Migrating to 0.2.0

<!--
  `appliesTo` is the only frontmatter key that changes how the page is stored.

  Without it, a page is unpinned: one row, shown for every version. With a
  semver range, the hub materialises the page once per release the range covers,
  so a reader on 0.9.0 never sees a migration note written for 1.0.

  Ranges: ">=1.0.0", "^1.2", "1.x", ">=1.0.0 <2.0.0".

  A range matching no released version is reported on the ingestion run and the
  page is skipped. `npm run bump` wrote this file pinned to the version it was
  cutting, so the range is right as long as that version is the one released —
  if the bump is abandoned, delete this page along with it.
-->

## What changed

Nothing you set up before breaks. The new **Action name** is empty on an upgraded
button, and an empty one is the 0.1.0 button exactly: the same event, the same
outputs, nothing called.

One thing that was wrong before is put right. The 0.1.0 page for reading the
outputs from a script — `executionContext.getEventSource().getOutputs()` and
`outputs.pressCount.value` — **never worked**. It was measured on a form for the
first time in 0.2.0: the event source is the column, which has no `getOutputs`,
and each output is keyed by the column and the control.

## What to do

:::steps
1. If you copied the 0.1.0 snippet for **channel 2**, replace it. Read the outputs
   from the control, by their full keys:

   ```javascript
   var control = formContext.getControl("contoso_actionanchor");

   control.addOnOutputChange(function () {
       var outputs = control.getOutputs();
       var count = outputs["contoso_actionanchor.fieldControl.pressCount"].value;
   });
   ```

2. Nothing else. To have the button call a Dataverse action — and through it a
   flow — see [Model-driven apps](model-driven#call-an-action-no-script).
:::
