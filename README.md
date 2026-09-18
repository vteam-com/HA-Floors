# Home Layout Card

A Lovelace card for Home Assistant that shows **your whole house, one storey at a time** —
a floorplan image per storey with live entity markers placed on top of it, plus a visual
editor for building the whole thing by clicking and dragging.

No Python, no `custom_components`, no restart: it is a single frontend resource.

```
Loft  ·  First Floor  ·  [Ground Floor]        ⛁  ⛶
┌───────────────────────────────────────────────────┐
│  💡on        📺playing  │        💡off            │
│      Living Room        │ Hall     Kitchen  🌡23.1°│
│        🌡21.4°          │    ├─────────────────────┤
├─────────────────────────┤    │      Dining         │
│         💡off           │ 🔒 │   WC    │ ⚙on       │
└───────────────────────────────────────────────────┘
```

## What it does

- **Any number of storeys.** Switch with tabs, pills or a dropdown; the card remembers
  which storey you were last looking at.
- **Any floorplan.** SVG, PNG, JPG or WebP, with an optional dark-theme variant per storey.
- **Live markers.** Five styles — icon puck, icon + state badge, text label, dot, and a
  whole-room area that lights up. Every marker follows its entity's icon, colour and state.
- **Room highlights.** If the storey is an inline SVG, any shape in it can be tinted by
  entity state — the kitchen floor glows when the kitchen light is on.
- **All-storeys view.** One button stacks every floor into an isometric pile so you can
  see the whole house at once; tap a storey to open it.
- **Zoom and pan.** Scroll or pinch to zoom into a corner of a big plan, drag to move,
  double-click to reset.
- **Actions.** Tap, hold and double-tap each map to more-info, toggle, navigate, a
  service call, or nothing.
- **A real visual editor.** Add storeys, set images, then click the plan to drop a marker
  and drag it where it belongs. Positions are stored as percentages, so swapping in a
  bigger image later does not move anything.

## Installation

### HACS (recommended)

1. HACS → **Frontend** → ⋮ → **Custom repositories**
2. Add this repository's URL with category **Lovelace**
3. Install **Home Layout Card**, then reload your browser

### Manual

1. Copy `dist/home-layout-card.js` to `config/www/home-layout-card.js`
2. **Settings → Dashboards → ⋮ → Resources → Add resource**
   - URL: `/local/home-layout-card.js`
   - Type: **JavaScript module**
3. Hard-reload the browser (Ctrl/Cmd + Shift + R)

## Getting a floorplan

Put image files in `config/www/` — anything there is served from `/local/`. So
`config/www/floorplans/ground.svg` is referenced as `/local/floorplans/ground.svg`.

Three ways to get one:

- **Draw it.** Any tool that exports SVG works ([Inkscape](https://inkscape.org),
  Figma, draw.io, Excalidraw). Keep one shape per room and give each an `id` if you want
  room highlights.
- **Trace it.** Screenshot the plan from your house survey, trace the walls, export.
- **Start from the samples.** `examples/ground-floor.svg`, `first-floor.svg` and `loft.svg`
  in this repository are complete three-storey plans with light and dark variants and
  `id`s on every room. Copy them to `config/www/floorplans/` and edit from there.

SVG is worth the extra effort: it stays sharp at any size, the file is a few KB, and it
is the only format that supports room highlights.

## Configuration

Add the card from the dashboard's **Add card** dialog and use the visual editor, or write
YAML directly.

### Card options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | **required** | `custom:home-layout-card` |
| `floors` | list | **required** | One entry per storey, see below |
| `title` | string | — | Card heading |
| `selector` | string | `tabs` | `tabs`, `buttons`, `dropdown` or `none` |
| `default_floor` | string | first | Storey `id` to open on |
| `remember_floor` | bool | `true` | Reopen on the storey last viewed (per browser) |
| `aspect_ratio` | string | — | e.g. `16:9`; default is the image's own ratio |
| `marker_size` | number | `34` | Diameter of an icon puck, in px |
| `color_on` | string | theme accent | Colour for active markers and room highlights |
| `color_off` | string | secondary text | Colour for inactive markers |
| `show_names` | bool | `false` | Caption every marker with its name |
| `show_states` | bool | `true` | Caption every marker with its state |
| `allow_zoom` | bool | `true` | Scroll / pinch zoom and drag to pan |
| `stack_view` | bool | `true` | Show the all-storeys button |
| `stack_default` | bool | `false` | Open the card already stacked |
| `theme_image` | bool | `false` | Invert plain images in dark mode (prefer `image_dark`) |

### Floor options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | string | generated | Stable identifier, used by `default_floor` |
| `name` | string | `Floor n` | Label in the selector |
| `level` | number | index | Height order: `0` ground, `1` first, `-1` basement |
| `icon` | string | — | Icon shown next to the name |
| `image` | string | — | Path to the floorplan, e.g. `/local/floorplans/ground.svg` |
| `image_dark` | string | — | Variant used when the HA theme is dark |
| `aspect_ratio` | string | — | Overrides the card-wide ratio for this storey |
| `opacity` | number | `1` | Fade the plan so markers stand out more |
| `inline_svg` | bool | auto | Embed the SVG instead of using `<img>`; required for `svg_bindings` |
| `svg_bindings` | list | `[]` | Tint shapes inside the SVG by entity state |
| `markers` | list | `[]` | The entities placed on this storey |

### Marker options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | **required** | Any entity id |
| `x`, `y` | number | `50` | Position as a **percentage** of the image, from the top-left |
| `style` | string | `icon` | `icon`, `badge`, `label`, `dot` or `area` |
| `name` | string | friendly name | Override the label |
| `icon` | string | entity icon | Override the icon |
| `size` | number | `marker_size` | Per-marker size in px |
| `width`, `height` | number | `20` | Size of an `area` marker, in percent |
| `color_on` / `color_off` | string | card default | Per-marker colours |
| `show_name` / `show_state` | bool | card default | Per-marker caption control |
| `hide_when_off` | bool | `false` | Only show the marker while the entity is active |
| `tap_action` | action | `more-info` | Standard HA action config |
| `hold_action` | action | `none` | Standard HA action config |
| `double_tap_action` | action | `none` | Standard HA action config |

Supported actions: `more-info`, `toggle`, `navigate` (+ `navigation_path`), `url`
(+ `url_path`), `call-service` (+ `service`, `data`, `target`), `none`.

### Room highlights (`svg_bindings`)

Only for storeys rendered with `inline_svg: true`. Give the room's shape an `id` in your
SVG, then bind it:

```yaml
inline_svg: true
svg_bindings:
  - selector: "#kitchen"      # any CSS selector; an id is the usual choice
    entity: light.kitchen
    color_on: "#ffca28"       # default: the card's color_on
    opacity_on: 0.45          # default: 0.45
    color_off: "#37474f"      # default: leave the shape as the SVG drew it
    opacity_off: 0.1
    tap_action:
      action: toggle
```

The SVG must be served from the same origin as Home Assistant (`/local/…` is), because
the card fetches and embeds it. If the fetch fails the card quietly falls back to a plain
`<img>`, and the browser console says why.

## Example

A complete three-storey configuration is in [`examples/advanced.yaml`](examples/advanced.yaml);
a short one is in [`examples/basic.yaml`](examples/basic.yaml).

```yaml
type: custom:home-layout-card
title: Our House
floors:
  - id: first
    name: First Floor
    level: 1
    image: /local/floorplans/first-floor.svg
    markers:
      - entity: light.main_bedroom
        x: 25
        y: 30
      - entity: binary_sensor.landing_motion
        x: 55
        y: 50
        style: dot
        hide_when_off: true
  - id: ground
    name: Ground Floor
    level: 0
    image: /local/floorplans/ground-floor.svg
    inline_svg: true
    svg_bindings:
      - selector: "#living"
        entity: light.living_room
    markers:
      - entity: light.living_room
        x: 17
        y: 22
      - entity: sensor.living_temperature
        x: 28
        y: 45
        style: badge
```

## Trying it without Home Assistant

`examples/demo.html` runs the card and its editor against a fake `hass` object, so you can
see both sides working before installing anything:

```bash
python3 -m http.server 8777
```

then open <http://localhost:8777/examples/demo.html>. Buttons at the top toggle the theme
and flip a couple of entities; edits in the right-hand editor feed straight into the card,
exactly as they do in a dashboard.

## Troubleshooting

**"Custom element doesn't exist: home-layout-card"** — the resource is not loaded. Check
the resource URL under Settings → Dashboards → Resources, and hard-reload the browser.

**The plan does not appear** — the path is wrong. Files go in `config/www/`, and the URL
starts with `/local/`, not `/config/www/` or `/www/`. The card tells you the path it tried.

**Room highlights do nothing** — the storey needs `inline_svg: true`, the selector must
match an element in the file, and the shape must have a fill for a tint to be visible.
The browser console lists any selector that matched nothing.

**A marker shows "entity not found"** — the entity id no longer exists; open the marker in
the editor and pick a new one.

**Markers drift when I change the image** — they will not, as long as the new image has the
same aspect ratio. Positions are percentages, not pixels.

## Licence

MIT — see [LICENSE](LICENSE).
