---
title: Examples
description: Five handlers, from the smallest useful one to a confirmed write with a busy state.
order: 6
---

# Examples

Every snippet is the `onAction` handler only. The `onLoad` that registers it is
in [Installation](installation), and it does not change between these.

## The smallest useful handler

```javascript
this.onAction = function () {
    Xrm.Navigation.openAlertDialog({ text: "It works." });
};
```

Worth running once before writing anything real: it proves the web resource
loaded, the handler registered, and the event fires.

## Set a field and let the user save

```javascript
this.onAction = function (payload) {
    var formContext = Contoso.formContext;

    formContext.getAttribute("contoso_reviewedon").setValue(new Date());
    formContext.getAttribute("contoso_reviewedby").setValue([{
        id: Xrm.Utility.getGlobalContext().userSettings.userId,
        name: Xrm.Utility.getGlobalContext().userSettings.userName,
        entityType: "systemuser"
    }]);
};
```

Stash `formContext` in your `onLoad` — the handler is not given one:

```javascript
this.onLoad = function (executionContext) {
    Contoso.formContext = executionContext.getFormContext();
    // …then register the handler as usual.
};
```

Nothing is saved here. The user sees the fields fill in and the form go dirty,
which is often exactly right: they get to look before committing.

## Confirmed, with a busy state and a result

Switch **Confirm before acting** on, set **Confirmation message** to the
question and **Confirmation button** to the verb.

```javascript
this.onAction = function (payload) {
    if (payload.action !== "confirm") {
        return;
    }

    if (!payload.entityId) {
        payload.preventDefault();
        Xrm.Navigation.openAlertDialog({ text: "Save the record first." });
        return;
    }

    payload.setBusy("Submitting…");

    Xrm.WebApi.updateRecord(payload.entityTypeName, payload.entityId, {
        contoso_status: 2
    }).then(
        function () {
            payload.setResult({ ok: true, message: "Sent for approval." });
            Contoso.formContext.data.refresh(false);
        },
        function (error) {
            payload.setResult({ ok: false, message: error.message });
        }
    );
};
```

Note the refresh. The row changed on the server; without it the form still shows
the old status.

## Refuse the press, and say why

```javascript
this.onAction = function (payload) {
    var total = Contoso.formContext.getAttribute("contoso_total").getValue();

    if (!total || total <= 0) {
        payload.preventDefault();
        payload.setResult({ ok: false, message: "Add a line item first." });
        return;
    }

    // …the real work.
};
```

`preventDefault()` stops the outputs and the signal write, so nothing downstream
sees a press that did not happen. `setResult()` puts the reason under the button
where the user is already looking.

Both are called synchronously, which is the only way `preventDefault()` works —
see [Limitations](limitations).

## Two buttons, one handler

```javascript
this.onLoad = function (executionContext) {
    var formContext = executionContext.getFormContext();

    Contoso.formContext = formContext;

    ["contoso_approveanchor", "contoso_rejectanchor"].forEach(function (name) {
        var control = formContext.getControl(name);

        if (control) {
            control.addEventHandler("onAction", Contoso.onAction);
        }
    });
};

this.onAction = function (payload) {
    var approving = payload.label === "Approve";

    payload.setBusy();

    Xrm.WebApi.updateRecord(payload.entityTypeName, payload.entityId, {
        contoso_status: approving ? 2 : 3
    }).then(
        function () { payload.setResult({ ok: true }); },
        function (error) { payload.setResult({ ok: false, message: error.message }); }
    );
};
```

`payload.label` is the button's caption, which is what tells the two apart.
Two controls means two registrations — `addEventHandler` binds to a control, not
to a form.

## Reaching a business rule instead of a script

Switch **Write to the signal column** on and bind the control to a dedicated text
column. Every press writes `press|4` or `confirm|5` into it, which fires the
column's `OnChange` — and that is visible to business rules and to real-time
workflows on update, neither of which can see a custom event.

```text
Condition:  Signal column  contains data
Action:     Set field value  Status Reason = Submitted
```

Keep the column out of the save unless you want the value stored:

```javascript
formContext.getAttribute("contoso_actionanchor").setSubmitMode("never");
```
