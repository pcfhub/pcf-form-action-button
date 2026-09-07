# Form Action Button

A model-driven form button that raises an event a form script can handle, confirm and answer.

[![Build](https://github.com/pcfhub/pcf-form-action-button/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-form-action-button/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-form-action-button/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-form-action-button/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-form-action-button), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

## What it does

Puts a button on a model-driven form and hands the press to a form script. The
script decides what happens; this control's job is to get the press there
cleanly and to look like the rest of the form doing it.

It reaches the script three ways at once, because each is missing somewhere. The
custom `onAction` event carries a payload and is the one worth using; the output
properties are the same press through `addOnOutputChange`, which is a stable API
rather than a preview one; and — only when a maker asks for it — a write into
the bound column, which is what a business rule or a real-time workflow can see.
All three ship because a handler that relies on one of them cannot detect that
the host dropped it.

**It binds a column, and that is the whole reason it exists as a separate
control from its canvas sibling.** A model-driven form hosts a field component
*on* a column, so `pcf-action-button` — which deliberately binds nothing — cannot
be placed on one. Here the column is an anchor: out of the box the control never
writes it, `getOutputs()` omits the key entirely, and `undefined` meaning "no
change" is for once the intent rather than the bug. Binding it to a live business
column is therefore safe until a maker switches `writeSignal` on, and the docs
say so twice.

**The event is raised before the outputs are written**, which is the reverse of
the canvas sibling. That control writes first so a maker's Power Fx cannot take
the outputs down with it; this one lets the handler *veto* the outputs, and a
veto cannot un-write them. The raise is inside a `try`, so a handler that throws
is logged and the outputs are written anyway — same guarantee, opposite means.

**The confirmation prefers the platform's dialog and falls back to an inline
two-step.** The skill's *Confirm, then destroy* warns against that substitution,
and is right about the case it describes: `pcf-row-commands` cannot delete in
canvas either, so an inline confirmation there is a nicer way of failing. This
control's action is raising an event, which works on every host — so the fallback
degrades the asking, not the doing.

## Properties

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `signal` | SingleLine.Text | bound | — | The column the button sits on. Written only when `writeSignal` is on |
| `label` | SingleLine.Text | input | `Submit` | The button's text, and its accessible name |
| `icon` | Enum | input | `none` | `none`, `send`, `delete` |
| `confirmRequired` | TwoOptions | input | `false` | Ask before raising the event |
| `confirmTitle` | SingleLine.Text | input | `""` | The dialog's title; empty falls back to the .resx |
| `confirmText` | SingleLine.Text | input | `""` | The dialog's body; empty falls back to the .resx |
| `confirmButtonLabel` | SingleLine.Text | input | `""` | The affirmative word — and the armed caption of the inline fallback |
| `writeSignal` | TwoOptions | input | `false` | Write each press into the bound column |
| `requirePrivilege` | Enum | input | `none` | `none`, `create`, `read`, `write`, `delete`, `append`, `appendTo` |
| `privilegeDenied` | Enum | input | `disable` | `disable` or `hide`, when the privilege is missing |
| `pressCount` | Whole.None | output | `0` | Increments on every press that commits |
| `lastAction` | SingleLine.Text | output | `""` | `press` or `confirm` |

One event, `onAction`, declared as a custom `<event>` — not a
`<common-event>`, because `addEventHandler` binds by the event's own name and
`OnSelect` is a reserved one belonging to a host this control does not support.
Its payload contract is in `docs/model-driven.md`; `refreshTypes` generates
nothing for an event, so `context.events` is reached through a hand-written
interface that declares the member **optional** — the platform types say it
cannot be missing, and that is a claim about the types.

Strings ship in five languages: 1033 English, 3082 Spanish, 1036 French, 1031
German, 1041 Japanese. Plain DOM, no framework, no platform libraries.

One `<uses-feature>`: `Utility`, `required="false"`, used only by the privilege
check. It is the one install-time permission prompt a maker sees, and the control
degrades rather than failing where the host has none. No `WebAPI` — the handler
already has `Xrm.WebApi` and the user's own context.

## On the hub

`demo.fidelity: "limited"`, and it cannot honestly be more.

Everything a visitor touches is real — the label, the glyph, the confirm swap,
the four-second revert, Escape, the outputs, and the guarantee that the bound
column stays put. Four things are not. There is no form script behind the demo,
so `onAction` reaches nothing, and the handler is most of the point. There is no
`openConfirmDialog` in the harness, so a confirmation shows the inline fallback
rather than the modal a form would put up. The busy and result states are driven
by a handler calling back, and there is no handler to call. And the privilege
check needs `context.utils` and a record identity, neither of which the harness
publishes — so it declines to gate, which is the correct behaviour and looks like
nothing happening.

All four are written into `demo.limitations`. Four presets: a plain button, a
confirmed delete with a glyph, one with `writeSignal` on so the outputs visibly
change on every press, and a long label to show it wrapping rather than
overflowing.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-form-action-button/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
npm run smoke      # assertions against the built bundle — see dev/
npm run harness    # serves dev/harness.html and opens it
```

`npm start` renders the control; `dev/` is for the states it cannot reach. Build
first, then `npm run smoke` for the assertions, or `npm run harness` for the
switches — field-level security, a failed business rule, a host that publishes
no theme or no column metadata, and for a dataset control, more than one page.
Both read the bundle `npm run build` wrote, and both are described in the header
of `dev/smoke.js`.

`npm run harness` serves the repository over `http://` rather than leaving you to
open the file: over `file://` a dataset fixture cannot be fetched and a module
script is refused, and both arrive as an empty control with a CORS error. It
takes `--port` and `--no-open`, and needs no dependency — `dev/serve.js` is
`node:http`. A React (virtual) control gets one too: `dev/fluent-stub.js` stands
in for the Fluent the platform would supply, and its header says exactly where
the stand-in is less capable than the real thing.

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `FormActionButton/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `FormActionButton/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `dev/` | A stand-in host: `npm run smoke` asserts, `harness.html` shows |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
