# Form Action Button

A button for a model-driven form that hands the press to a form script, with a
confirmation, a busy state and a way for the handler to answer back.

This is the first control in the catalogue to consume the **model-driven** half
of the events feature, the first to use `context.utils.hasEntityPrivilege`, and
the first whose bound property exists to be *not* written. Most of what follows
is about those three.

## The correction this control is built on

**`pcf-action-button`'s manifest and `SPEC.md` both say a model-driven form has
no way to bind an event, and that is wrong.** Its manifest comment reads: "A
model-driven form hosts a code component *on a column*, and it has no Power Fx to
bind an event to — the form-side answer to 'I want a button' is a command-bar
button." The first half is right and is why that control is canvas-only. The
second half is not.

Read out of Microsoft Learn during design:

- The [`event` element](https://learn.microsoft.com/power-apps/developer/component-framework/manifest-schema-reference/event)
  reference states **"Available for: Canvas and model-driven apps."** Only the
  summary table on the manifest-schema index says canvas alone; the element's own
  page, the `context.events` reference, and a full tutorial all cover
  model-driven.
- A form script binds a handler with
  `formContext.getControl(name).addEventHandler("<eventName>", fn)` —
  [addEventHandler](https://learn.microsoft.com/power-apps/developer/model-driven-apps/clientapi/reference/controls/addeventhandler),
  whose *Control types supported* is "Custom code components".
- **Model-driven events carry a payload, and the payload may carry functions.**
  Microsoft's own tutorial passes `{ message, preventDefault }` and calls
  `params.preventDefault()` from the handler; the events overview shows the same
  shape under the name `callBackFunction`. That is a two-way channel canvas does
  not have — Power Fx cannot be handed a callback.
- A form script can watch outputs directly:
  [addOnOutputChange](https://learn.microsoft.com/power-apps/developer/model-driven-apps/clientapi/reference/controls/addonoutputchange)
  fires `OnOutputChange`, and `control.getOutputs()` returns the dictionary.
- The FAQ's long-standing workaround still holds as a third route: bind a column,
  write to it, and let the column's `OnChange` reach `formContext`. It also names
  the `submitMode: "never"` trick this control's docs repeat.

The canvas control's `SPEC.md` and manifest have been corrected, and both now
point here. The reason it is canvas-only is the one that was always true: it
binds no column, so it cannot be placed on a form.

**Custom events are still marked preview.** See *Not verified*.

## Three channels, and why all three ship

| # | Channel | Script side | Default |
| --- | --- | --- | --- |
| 1 | custom `<event name="onAction">` | `control.addEventHandler("onAction", fn)` — payload, callbacks | always |
| 2 | output properties | `control.addOnOutputChange(fn)` + `control.getOutputs()` | always |
| 3 | the bound column | its own `OnChange`, business rules, workflows | `writeSignal`, off |

Channel 1 is the feature. Channel 2 is there because channel 1 is preview and a
handler cannot detect that the platform stopped delivering it. Channel 3 is off
by default because it writes business data.

**The event is raised BEFORE the outputs are written, which is the reverse of
`pcf-action-button`.** That control writes first so a maker's Power Fx cannot
take the outputs down with it. Here the handler is allowed to *veto* the outputs,
and a veto cannot un-write them — so the raise goes first, inside a `try`, and a
handler that throws is logged and the outputs written anyway. Same guarantee,
opposite means, and it is worth stating because the two files otherwise look like
one is a copy of the other with a bug in it.

## The payload contract

```ts
{ action, pressCount, label, entityTypeName?, entityId?,
  preventDefault(), setBusy(message?), setResult({ ok, message? }) }
```

Three rules, each of which is a smoke assertion:

1. **Latched.** Every callback closes over the press token it was built for. An
   async handler closes over its payload by construction, and a second press
   while the first is still running is one click — so a stale callback is
   ordinary rather than exotic.
2. **Dead after `destroy()`.** The callbacks write DOM. A handler holding one
   across a form navigation must not reach a detached control.
3. **`preventDefault()` is synchronous only.** It is refused with a console
   warning from a `.then()`, rather than half-applied. The Client API says the
   same of its own change events, which must not be asynchronous.

`pressCount` in the payload is the value the output **will** hold if the press
commits, so a vetoed press announces a number it does not consume. That is the
honest reading and it is asserted both ways.

## Platform behaviour worth knowing

**A change event fires on a change, not on a write.** `OnOutputChange` and a
column's `OnChange` are both in that family, so two consecutive confirmed presses
writing `lastAction: "confirm"` are one signal and one silence. `pressCount`
exists solely to make the repeat observable, and `writeSignal` puts the count
into the column value for the same reason.

**`getOutputs()` omitting a key is the design, once.** With `writeSignal` off the
control must leave the anchor column exactly as it found it, and "no change" is
precisely what an absent key means. Everywhere else in this catalogue that is the
`pcf-star-rating` bug; here it is the guarantee that makes the control safe to
bind to a live column. The key is *omitted* rather than set to `undefined`
because the two mean the same thing to the platform and only one of them reads
like a decision.

**`hasEntityPrivilege` is synchronous and returns a boolean** — alone in
`context.utils`, where everything else is a promise. It takes numeric enums, not
strings: `PrivilegeType` 0 None … 8 AppendTo, `PrivilegeDepth` −1 None … 3 Global.
A string argument gets no complaint from anything; the call simply answers about
a privilege nobody asked for. Basic (`0`) is the right depth to ask for because
Dataverse resolves depth upwards.

**Every way of not knowing answers `true`.** `context.utils` is absent in canvas
and without the `Utility` feature; `contextInfo` is absent off a record. A
control that hid itself there would go missing for a reason nothing on screen
explains, whereas letting the press through leaves the server to refuse — which
at least produces a message. A host returning a promise instead of a boolean
would be truthy and would also fail open, which is the same safe direction.

**Anything a callback writes is one `updateView` away from being clobbered.**
`setBusy()` runs inside the handler, which runs inside `raise()`, which then
calls `notifyOutputChanged()` — and the platform answers that with an
`updateView`. The first version held the handler's message in a field that
`render()` refreshed from the `.resx`, so the default replaced it immediately, on
every host, and only while busy. **Anything set from a payload callback has to
live somewhere `render()` does not touch**, or be written once and not held at
all.

**A control with two feedback channels has to decide which one each state uses,
and this one had both saying the same sentence.** While busy, the caption showed
the handler's message *and* the live region announced it — the same words printed
twice, once on the button and once underneath. It survived a code review and 71
green assertions and was caught the moment a screenshot was taken of it.

The rule that settles it: **does the state change what the button *is*, or only
what it is *doing*?** An armed confirmation changes the question — "Delete
record" becomes "Delete permanently" — so the caption must carry it and the
region only backs it up. Busy changes nothing about the button's identity, so the
spinner and `aria-busy` carry "working" and the region carries the handler's
sentence, alone. The caption now never changes for busy, and there is an
assertion on both halves.

This is why the live region is *visible* here and hidden in
`pcf-action-button` — there, everything it ever said duplicated the caption by
construction, so showing it would have been the same bug permanently.

**The spinner replaces the glyph rather than joining it**, found in the same
screenshot. A send arrow beside a spinning ring is two leading marks competing
for one slot. `applyIcon` therefore only *records* the maker's choice and
`paint()` decides what is shown, which is why the two are separate functions.

Both of these are the same lesson twice: **73 behavioural assertions cannot see
what a control looks like.** Neither defect was a wrong value or a missing
branch — each was two correct things drawn in the same place — and both survived
a code review. The screenshot pass is not documentation work that happens after
the control is finished; it is the only step that looks at the thing.

**The inline confirm fallback is a legitimate substitution here, and the skill
says it is not.** *Confirm, then destroy* warns against replacing
`openConfirmDialog` with an inline two-step on a host that lacks the dialog, and
is right about `pcf-row-commands`: canvas has no `webAPI` either, so an inline
confirmation there is a nicer way of failing. This control's action is *raising
an event*, which works on every host — so the fallback degrades the asking and
not the doing. The distinction has been promoted to the skill.

**One `export` per entry file.** `pcf-scripts`' `sourceCodeValidator.js` counts
`export` modifiers on top-level nodes of `index.ts` and fails at two. `asBoolean`,
`describeError`, `createIcon`, the icon tables and both interfaces are
module-private for that reason rather than by preference.

## The dev rig

Three additions were made to `_template/dev/host.js` **in the same change**,
because none is specific to this control:

1. **`buildNavigation()`**, ported from the dataset rig — `openUrl`, `openForm`,
   and the three dialogs behind a `dialogs` switch with four answers
   (`confirmed` / `cancelled` / `rejected` / `absent`) plus `hasNavigation`. The
   field rig previously stubbed `openUrl` alone, so no field control could reach
   a dialog branch at all.
2. **`utils.hasEntityPrivilege`**, logging both enum arguments — because passing
   Read where Write was meant is invisible otherwise, almost every user having
   Read.
3. **`buildEvents()` accepting handlers, not only names.** The bag used to map an
   array of names onto loggers, which is all a canvas-shaped event needs. A
   model-driven event needs the handler to call back, so the option now also
   takes `{ name: fn }` and calls the handler *after* the log entry, so `calls`
   records the raise in the order it happened even when the handler re-enters the
   control.

The harness page gained the matching switches, plus a *What the form script does*
selector with six behaviours — three of them mistakes worth seeing from the
user's side rather than from a code review: a handler that throws, one that
vetoes silently, and one that goes busy and never reports back.

**The stylesheet was verified in a real browser**, and the verification found a
trap rather than a bug: `getComputedStyle` on a transitioned property in a
**hidden or background** browser pane returns the *from* value, because the pane
is not compositing and the transition never advances. The armed state read as
neutral grey through three rounds of investigation before the cause was clear.
Neutralise transitions (`el.style.transition = 'none'`) before measuring, and
compare against a freshly-inserted probe element, which has no transition to be
frozen in. With that done every state measured correctly: armed `#d13438` on
`#fdf3f4`, disabled `#f0f0f0` with `not-allowed`, dark `#292929`, the failure
line `#bc2f32`, the spinner animating, and the send glyph mirrored under
`dir="rtl"`. This has been promoted to the skill.

## Media, and how to remake it

`media/logo.svg` is drawn for 32px, on the PCFHub ramp, verbatim, in
`userSpaceOnUse` across the whole 96 canvas — the same construction as
`pcf-date-range-picker`'s. Its own header records the three compositions that
were rejected, including the one worth knowing: **a pill with a dot in it is a
toggle switch**, not a button, and at 32px that is the only thing it reads as.
Four interiors were rendered side by side at 72, 32 and 32-on-dark to settle it.

`logo.png` and the four screenshots are generated, not hand-cropped, and there
is no dependency in the repository that makes them — the rasteriser is **headless
Chrome**, which is already on any machine that can run the dev harness:

```bash
chrome --headless --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --screenshot=media/logo.png \
  --window-size=256,256 file:///…/logo-256.html
```

`--default-background-color=00000000` is what makes the PNG transparent; without
it the logo ships on an opaque white square that looks wrong on the hub's dark
theme. Verify with the IHDR colour type — 6 is RGBA.

The screenshots are rendered at **400×72 CSS with
`--force-device-scale-factor=2`**, which is where the catalogue's 800×144 crops
come from: 20px padding, a 32px button, 20px padding. States with a status line
are 400×92 → 800×184. Two things the shot page has to do, and both were bugs
first:

- **`captureRegistration` before the bundle `<script>`.** The bundle registers
  itself the moment it loads and, with nothing listening, takes its own
  else-branch and hangs the constructor on a local. The symptom is an empty
  container and no error at all.
- **`* { transition: none !important; }`.** A headless screenshot is taken while
  a transition started at load is still at t=0, so an armed button is
  photographed wearing its previous colours. Same trap as the one under
  *The dev rig* above, in a different tool.

The page itself lives in the scratchpad rather than in `dev/`, deliberately:
`dev/` is a stand-in host for finding bugs, and a screenshot rig is a
publishing tool. Rebuild it from this section rather than looking for it.

## Demo

`fidelity: "limited"`, and it cannot honestly be more. There is no form script
behind the demo, so the handler — most of the point — reaches nothing; the
confirmation dialog is the hub's stand-in rather than the platform's; and busy
and result are driven by a handler calling back and there is none. All three
are in `demo.limitations`.

**Privilege gating came off that list on 2026-09-28.** It needs the form's
table from `mode.contextInfo`, which the harness publishes only with a stand-in
Dataverse behind the demo, and until pcfhub/pcfhub#53 that stand-in granted
every privilege anyway. `demo/record.json` now holds only a `dataverse` section:
an account record, and `privileges: { delete: false }` on the account table,
which `utils.hasEntityPrivilege` answers synchronously and by number as the
platform does. A *No delete privilege* preset requires Delete. The others
require none, so the confirmation and the write signal are untouched.

Checked with 0.1.0's published bundle against that harness, before the push:

- Require Delete, denied Disable: the button drawn and disabled;
- denied Hide: the button gone;
- Require Write, which the user holds: the button back and enabled.

**Until 2026-09-27 a confirm preset on the hub was a dead button, and this
section said otherwise.** The harness's `openConfirmDialog` called
`window.confirm`, and the demo frame is sandboxed without `allow-modals`, so the
browser answered "cancelled" without showing anything. The control
feature-detects the method, found it, took its platform path and was told the
user declined: a press raised nothing, while `demo.limitations` described an
inline fallback it never reached. A method that is present and always says no
looks exactly like a user saying no; pressing the button on the live page is
what found it. The hub now draws the dialog in the page (pcfhub#42).

## Not verified

**That `addEventHandler("onAction", fn)` fires for a custom `<event>` on a real
form, and that the payload arrives intact including its functions.** This is the
control's headline feature and nothing on this machine can prove it. The schema
proves the manifest compiles; the type definitions promise a bag unconditionally,
which is a promise about types; the documentation is preview. The control
therefore feature-detects and always writes its outputs, so a host that binds
nothing still produces a working button.

*What would prove it:* import the managed solution, put the control on a column,
attach the `docs/installation.md` web resource to the form's On Load, and press.
An alert proves the bag is populated and the handler bound. Then have the handler
call `payload.preventDefault()` and confirm the outputs do **not** move, and
`payload.setBusy()` / `setResult()` and confirm the button does.

**That `addOnOutputChange` + `getOutputs()` sees `pressCount` change**, and that
two identical confirmed presses produce two events rather than one.

**That a `writeSignal` write fires the bound column's `OnChange`**, and that
`setSubmitMode("never")` keeps it out of the save.

**That `hasEntityPrivilege` answers what the user's roles say.** Two users, one
with the privilege and one without, on the same form.

**That Dataverse *imports* a solution whose manifest carries a custom `<event>`
and a `<uses-feature name="Utility" required="false">`.** The **pack** half is
verified: a clean `msbuild /t:build /restore /p:configuration=Release` produced
both zips with `PCFHub.FormActionButton` listed under CustomControls, and the
production bundle is one minified line with no webpack banner. The import half
needs an environment.

**That every JavaScript snippet in `docs/` runs.** Nothing in the pipeline reads
a fenced code block — `pcf-date-range-picker/SPEC.md` records a formula that was
wrong for a release. Every snippet in `installation.md`, `model-driven.md`,
`examples.md` and `faq.md` must be pasted into a real form before the tag.

**That the platform's confirmation dialog looks right at the sizes this control
asks for.** `openConfirmDialog` is called with strings and no options, so the
platform picks the size; nobody has seen it with a long `confirmText`.

**What the maker experience is if somebody adds this to a canvas app.** It should
be poor and the docs say it is unsupported, but nobody has tried it.

## Promoted to the skill

Both of these are now in the skill's `references/control-patterns.md` rather than
only here:

- **An events section**, which did not exist. `<event>` versus `<common-event>`,
  the reserved names, `pcfAllowEvents`, `refreshTypes` emitting nothing, the
  non-optional `context.events`, the model-driven consumers (`addEventHandler`,
  payload callbacks, `addOnOutputChange`), the three-channel table, and the
  double-fire hazard.
- **The `getComputedStyle`-in-a-hidden-pane trap**, under *Styling → Verify it*.

And one correction to *Navigation and dialogs*: the exception to *Confirm, then
destroy*, which is that an inline fallback is right when the action itself is
host-independent.
