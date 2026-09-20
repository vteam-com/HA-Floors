/**
 * Home Layout Card
 * A Lovelace card that displays a multi-story home floorplan (SVG or image)
 * with live entity markers placed on top of each story.
 *
 * https://github.com/YOUR_USERNAME/home-layout-card
 */

const HLC_VERSION = "1.4.0";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const fireEvent = (node, type, detail = {}, options = {}) => {
  const event = new Event(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
  });
  event.detail = detail;
  node.dispatchEvent(event);
  return event;
};

const uid = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const round2 = (v) => Math.round(v * 100) / 100;

/** States that never count as "active". */
const INACTIVE_STATES = new Set([
  "off", "closed", "locked", "not_home", "idle", "standby", "docked",
  "unavailable", "unknown", "", "paused",
]);

/** Domains whose numeric state should never be treated as "on". */
const NUMERIC_DOMAINS = new Set([
  "sensor", "number", "input_number", "counter", "weather", "sun",
  "device_tracker", "person", "input_datetime", "datetime", "text",
  "input_text", "select", "input_select", "button", "input_button",
  "update", "image", "date",
]);

const isActive = (stateObj) => {
  if (!stateObj) return false;
  const state = String(stateObj.state).toLowerCase();
  if (INACTIVE_STATES.has(state)) return false;
  const domain = stateObj.entity_id.split(".")[0];
  if (NUMERIC_DOMAINS.has(domain)) {
    // person/device_tracker: "home" is the active state
    if (domain === "person" || domain === "device_tracker") return state === "home";
    return false;
  }
  return true;
};

const isUnavailable = (stateObj) =>
  !stateObj || stateObj.state === "unavailable" || stateObj.state === "unknown";

const DOMAIN_ICONS = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch-variant",
  fan: "mdi:fan",
  climate: "mdi:thermostat",
  cover: "mdi:window-shutter",
  lock: "mdi:lock",
  media_player: "mdi:television",
  binary_sensor: "mdi:radiobox-blank",
  sensor: "mdi:eye",
  camera: "mdi:cctv",
  vacuum: "mdi:robot-vacuum",
  scene: "mdi:palette",
  script: "mdi:script-text",
  automation: "mdi:robot",
  person: "mdi:account",
  device_tracker: "mdi:account",
  humidifier: "mdi:air-humidifier",
  water_heater: "mdi:water-boiler",
  valve: "mdi:pipe-valve",
  siren: "mdi:bullhorn",
  alarm_control_panel: "mdi:shield-home",
};

const fallbackIcon = (entityId, stateObj) => {
  if (stateObj && stateObj.attributes && stateObj.attributes.icon) {
    return stateObj.attributes.icon;
  }
  const domain = String(entityId || "").split(".")[0];
  return DOMAIN_ICONS[domain] || "mdi:help-circle-outline";
};

const friendlyName = (entityId, stateObj) => {
  if (stateObj && stateObj.attributes && stateObj.attributes.friendly_name) {
    return stateObj.attributes.friendly_name;
  }
  const parts = String(entityId || "").split(".");
  return (parts[1] || entityId || "").replace(/_/g, " ");
};

const formatState = (hass, stateObj) => {
  if (!stateObj) return "—";
  try {
    if (hass && typeof hass.formatEntityState === "function") {
      return hass.formatEntityState(stateObj);
    }
  } catch (err) {
    /* fall through to the manual formatting below */
  }
  const unit = stateObj.attributes && stateObj.attributes.unit_of_measurement;
  return unit ? `${stateObj.state} ${unit}` : stateObj.state;
};

/** Short state used on compact markers (e.g. "21.5°" instead of "21.5 °C"). */
const compactState = (hass, stateObj) => {
  if (!stateObj) return "—";
  const attrs = stateObj.attributes || {};
  const domain = stateObj.entity_id.split(".")[0];
  if (domain === "climate") {
    const current = attrs.current_temperature;
    if (current !== undefined && current !== null) {
      return `${current}°`;
    }
  }
  const unit = attrs.unit_of_measurement;
  if (unit && !Number.isNaN(Number(stateObj.state))) {
    const value = Number(stateObj.state);
    const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded}${unit.startsWith("°") ? "°" : ` ${unit}`}`;
  }
  return formatState(hass, stateObj);
};

/* ------------------------------------------------------------------ *
 * Lengths, areas and unit systems
 *
 * Room geometry is always stored in metres, whatever units are on display.
 * One canonical unit keeps a config portable: moving the card (or Home
 * Assistant) between metric and imperial re-labels the plan instead of
 * silently resizing the house.
 * ------------------------------------------------------------------ */

const M_PER_FT = 0.3048;
const SQM_PER_SQFT = M_PER_FT * M_PER_FT;

const trimNum = (value, places) => String(Number(Number(value).toFixed(places)));

/**
 * Parse a length into metres. A bare number means metres unless `assume` says
 * otherwise, and an explicit suffix always wins — so `3.6`, `3.6m`, `12ft`,
 * `12'6"`, `150cm` and `18in` all mean what they look like.
 */
const parseLength = (value, assume) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return assume === "ft" ? value * M_PER_FT : value;
  }
  const text = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;

  const feetInches = text.match(/^(-?[\d.]+)\s*(?:'|ft|feet|foot)\s*(?:(-?[\d.]+)\s*(?:"|in|inch|inches)?)?$/);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = feetInches[2] === undefined ? 0 : Number(feetInches[2]);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    return (feet + inches / 12) * M_PER_FT;
  }
  const inchesOnly = text.match(/^(-?[\d.]+)\s*(?:"|in|inch|inches)$/);
  if (inchesOnly) {
    const value2 = Number(inchesOnly[1]);
    return Number.isFinite(value2) ? (value2 / 12) * M_PER_FT : null;
  }
  const mm = text.match(/^(-?[\d.]+)\s*mm$/);
  if (mm) return Number.isFinite(Number(mm[1])) ? Number(mm[1]) / 1000 : null;
  const cm = text.match(/^(-?[\d.]+)\s*cm$/);
  if (cm) return Number.isFinite(Number(cm[1])) ? Number(cm[1]) / 100 : null;
  const metres = text.match(/^(-?[\d.]+)\s*m(?:etre|eter)?s?$/);
  if (metres) return Number.isFinite(Number(metres[1])) ? Number(metres[1]) : null;

  const bare = Number(text);
  if (!Number.isFinite(bare)) return null;
  return assume === "ft" ? bare * M_PER_FT : bare;
};

/** Parse a pair into metres: [4.2, 3.6], "4.2 x 3.6", "12ft x 9ft", {width, depth}. */
const parsePair = (value, assume) => {
  if (value === undefined || value === null || value === "") return null;
  const pair = (a, b) => (a === null && b === null ? null : [a || 0, b || 0]);

  if (Array.isArray(value)) {
    return pair(parseLength(value[0], assume), parseLength(value[1], assume));
  }
  if (typeof value === "object") {
    const width = value.width !== undefined ? value.width : value.w;
    const depth = value.depth !== undefined ? value.depth : (value.height !== undefined ? value.height : value.d);
    return pair(parseLength(width, assume), parseLength(depth, assume));
  }
  const parts = String(value).split(/\s*(?:x|\u00d7|\*)\s*/i).filter(Boolean);
  if (parts.length >= 2) {
    return pair(parseLength(parts[0], assume), parseLength(parts[1], assume));
  }
  const single = parseLength(value, assume);
  return single === null ? null : [single, single];
};

/** `auto` follows Home Assistant's own unit system; anything else is explicit. */
const unitSystemOf = (config, hass) => {
  const chosen = config && config.units;
  if (chosen === "metric" || chosen === "imperial") return chosen;
  const length = hass && hass.config && hass.config.unit_system && hass.config.unit_system.length;
  return length === "mi" || length === "ft" ? "imperial" : "metric";
};

const formatLength = (metres, system) => {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return "";
  if (system === "imperial") {
    const totalInches = (metres / M_PER_FT) * 12;
    let feet = Math.floor(Math.abs(totalInches) / 12);
    let inches = Math.round(Math.abs(totalInches) - feet * 12);
    if (inches === 12) {
      feet += 1;
      inches = 0;
    }
    const sign = totalInches < 0 ? "-" : "";
    return inches ? `${sign}${feet}\u2032${inches}\u2033` : `${sign}${feet}\u2032`;
  }
  return `${trimNum(metres, 2)} m`;
};

const formatArea = (sqm, system) => {
  if (!Number.isFinite(sqm) || sqm <= 0) return "";
  if (system === "imperial") return `${Math.round(sqm / SQM_PER_SQFT)} sq ft`;
  return `${trimNum(sqm, 1)} m\u00b2`;
};

/** Value shown in an editor field, in whichever unit the user is working in. */
const lengthFieldValue = (metres, system) =>
  metres === null || metres === undefined || !Number.isFinite(metres)
    ? ""
    : trimNum(system === "imperial" ? metres / M_PER_FT : metres, 2);

const lengthFieldUnit = (system) => (system === "imperial" ? "ft" : "m");

/* ------------------------------------------------------------------ *
 * Laying a storey out
 *
 * People describe a house relationally — "the kitchen is east of the hall,
 * with a door five metres along". So that is what a room stores, and the
 * coordinates are derived from it. Nobody should ever type an x/y.
 * ------------------------------------------------------------------ */

const WALLS = ["north", "east", "south", "west"];
const OPPOSITE_WALL = { north: "south", south: "north", east: "west", west: "east" };
const DEFAULT_DOOR_WIDTH = 0.9; // metres, a touch under a standard 36" doorway

/** The stretch of shared wall two adjacent rooms actually have in common. */
const sharedWall = (parent, child, wall) => {
  const vertical = wall === "east" || wall === "west";
  if (vertical) {
    const from = Math.max(parent.y, child.y);
    const to = Math.min(parent.y + parent.depth, child.y + child.depth);
    const at = wall === "east" ? parent.x + parent.width : parent.x;
    return to > from ? { vertical: true, at, from, to, origin: parent.y } : null;
  }
  const from = Math.max(parent.x, child.x);
  const to = Math.min(parent.x + parent.width, child.x + child.width);
  const at = wall === "south" ? parent.y + parent.depth : parent.y;
  return to > from ? { vertical: false, at, from, to, origin: parent.x } : null;
};

const doorSegment = (parent, child, wall, door) => {
  const shared = sharedWall(parent, child, wall);
  if (!shared) return null;
  const span = shared.to - shared.from;
  const width = Math.min(door.width, span);
  const start = door.at === null
    ? shared.from + (span - width) / 2
    : clamp(shared.origin + door.at, shared.from, shared.to - width);
  return shared.vertical
    ? { vertical: true, x1: shared.at, y1: start, x2: shared.at, y2: start + width }
    : { vertical: false, x1: start, y1: shared.at, x2: start + width, y2: shared.at };
};

/**
 * Resolve a storey's room graph into absolute rectangles, doors and an extent.
 * A room with no `attach` anchors the plan; everything else hangs off a wall
 * of another room. Loops and dangling references are reported, not thrown.
 */
const solveFloorLayout = (floor) => {
  const rooms = (floor.rooms || []).filter((room) => room.width > 0 && room.depth > 0);
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const boxes = new Map();
  const doors = [];
  const problems = [];

  const anchored = (room) => ({ x: room.x || 0, y: room.y || 0, width: room.width, depth: room.depth });

  const place = (room, chain) => {
    if (boxes.has(room.id)) return boxes.get(room.id);
    if (chain.has(room.id)) {
      problems.push(`"${room.name}" is attached in a loop — anchoring it instead.`);
      const looped = anchored(room);
      boxes.set(room.id, looped);
      return looped;
    }
    chain.add(room.id);

    const attach = room.attach;
    const parent = attach ? byId.get(attach.to) : null;
    if (attach && !parent) {
      problems.push(`"${room.name}" is attached to a room that no longer exists.`);
    }

    let box;
    if (!parent) {
      box = anchored(room);
    } else {
      const p = place(parent, chain);
      const offset = attach.offset;
      if (attach.wall === "east") {
        box = { x: p.x + p.width, y: p.y + offset, width: room.width, depth: room.depth };
      } else if (attach.wall === "west") {
        box = { x: p.x - room.width, y: p.y + offset, width: room.width, depth: room.depth };
      } else if (attach.wall === "north") {
        box = { x: p.x + offset, y: p.y - room.depth, width: room.width, depth: room.depth };
      } else {
        box = { x: p.x + offset, y: p.y + p.depth, width: room.width, depth: room.depth };
      }
      if (attach.door) {
        const segment = doorSegment(p, box, attach.wall, attach.door);
        if (segment) doors.push({ ...segment, room: room.id, to: parent.id });
        else problems.push(`"${room.name}" has a door but does not touch "${parent.name}".`);
      }
    }

    chain.delete(room.id);
    boxes.set(room.id, box);
    return box;
  };

  rooms.forEach((room) => place(room, new Set()));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  boxes.forEach((box) => {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.depth);
  });
  if (!Number.isFinite(minX)) {
    return { boxes, doors, problems, extent: null };
  }

  // Attaching westwards or northwards pushes rooms negative; slide it all back.
  boxes.forEach((box) => {
    box.x -= minX;
    box.y -= minY;
  });
  doors.forEach((door) => {
    door.x1 -= minX;
    door.x2 -= minX;
    door.y1 -= minY;
    door.y2 -= minY;
  });

  return {
    boxes,
    doors,
    problems,
    extent: {
      // An explicit storey size only ever pads the plan; it never clips a room.
      width: Math.max(floor.width || 0, maxX - minX),
      depth: Math.max(floor.depth || 0, maxY - minY),
    },
  };
};

/**
 * Which wall of `parentBox` a room would best hang off to land near `desired`.
 * This is what turns a drag into a change of attachment rather than a stray
 * coordinate, so the plan stays a graph the user can still reason about.
 */
const bestAttachment = (parentBox, room, desired) => {
  let best = null;
  WALLS.forEach((wall) => {
    let x;
    let y;
    let offset;
    if (wall === "east") {
      offset = desired.y - parentBox.y;
      x = parentBox.x + parentBox.width;
      y = parentBox.y + offset;
    } else if (wall === "west") {
      offset = desired.y - parentBox.y;
      x = parentBox.x - room.width;
      y = parentBox.y + offset;
    } else if (wall === "north") {
      offset = desired.x - parentBox.x;
      x = parentBox.x + offset;
      y = parentBox.y - room.depth;
    } else {
      offset = desired.x - parentBox.x;
      x = parentBox.x + offset;
      y = parentBox.y + parentBox.depth;
    }
    const distance = Math.hypot(x - desired.x, y - desired.y);
    if (!best || distance < best.distance) best = { wall, offset: round2(offset), distance };
  });
  return best;
};

/**
 * Devices sit inside their room. Anything without an explicit spot is spread
 * over a grid, so dropping an entity in never needs a position to be useful.
 */
const roomDeviceMarkers = (room, box, extent) => {
  const auto = room.devices.filter((device) => device.x === null || device.y === null);
  const cols = Math.max(1, Math.ceil(Math.sqrt(auto.length)));
  const rows = Math.max(1, Math.ceil(auto.length / cols));

  return room.devices.map((device) => {
    let rx = device.x;
    let ry = device.y;
    if (rx === null || ry === null) {
      const slot = auto.indexOf(device);
      rx = (((slot % cols) + 0.5) / cols) * 100;
      ry = ((Math.floor(slot / cols) + 0.5) / rows) * 100;
    }
    return {
      ...device,
      x: ((box.x + (rx / 100) * box.width) / extent.width) * 100,
      y: ((box.y + (ry / 100) * box.depth) / extent.depth) * 100,
    };
  });
};

/* ------------------------------------------------------------------ *
 * Config normalisation
 * ------------------------------------------------------------------ */

const DEFAULT_ACTIONS = {
  tap_action: { action: "more-info" },
  hold_action: { action: "none" },
  double_tap_action: { action: "none" },
};

const normalizeMarker = (raw, index) => {
  const marker = typeof raw === "string" ? { entity: raw } : { ...(raw || {}) };
  return {
    id: marker.id || uid("m"),
    entity: marker.entity || "",
    name: marker.name,
    icon: marker.icon,
    style: marker.style || "icon", // icon | badge | label | dot | area
    x: marker.x === undefined ? 50 : clamp(Number(marker.x), -20, 120),
    y: marker.y === undefined ? 50 + index * 4 : clamp(Number(marker.y), -20, 120),
    width: marker.width,   // only used by style: area
    height: marker.height, // only used by style: area
    size: marker.size,     // px, overrides the card-wide marker size
    color_on: marker.color_on,
    color_off: marker.color_off,
    show_name: marker.show_name,
    show_state: marker.show_state,
    hide_when_off: Boolean(marker.hide_when_off),
    tap_action: marker.tap_action || DEFAULT_ACTIONS.tap_action,
    hold_action: marker.hold_action || DEFAULT_ACTIONS.hold_action,
    double_tap_action: marker.double_tap_action || DEFAULT_ACTIONS.double_tap_action,
  };
};

const normalizeBinding = (raw) => {
  const binding = { ...(raw || {}) };
  return {
    selector: binding.selector || binding.id || "",
    entity: binding.entity || "",
    color_on: binding.color_on,
    color_off: binding.color_off,
    opacity_on: binding.opacity_on,
    opacity_off: binding.opacity_off,
    tap_action: binding.tap_action || { action: "more-info" },
  };
};

/** A device is a marker that lives inside a room, positioned as a % of it. */
const normalizeDevice = (raw, index) => {
  const cfg = typeof raw === "string" ? { entity: raw } : { ...(raw || {}) };
  const device = normalizeMarker(cfg, index);
  // null means "put it wherever looks sensible", which is the common case.
  device.x = cfg.x === undefined || cfg.x === null ? null : clamp(Number(cfg.x), 0, 100);
  device.y = cfg.y === undefined || cfg.y === null ? null : clamp(Number(cfg.y), 0, 100);
  return device;
};

const normalizeDoor = (raw) => {
  if (raw === undefined || raw === null || raw === false) return null;
  if (raw === true) return { at: null, width: DEFAULT_DOOR_WIDTH };
  if (typeof raw === "number" || typeof raw === "string") {
    return { at: parseLength(raw), width: DEFAULT_DOOR_WIDTH };
  }
  const at = parseLength(raw.at !== undefined ? raw.at : raw.offset);
  const width = parseLength(raw.width);
  return { at, width: width === null || width <= 0 ? DEFAULT_DOOR_WIDTH : width };
};

const normalizeAttach = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const to = raw.to || raw.room || "";
  if (!to) return null;
  const wall = String(raw.wall || "").toLowerCase();
  const offset = parseLength(raw.offset);
  return {
    to,
    wall: WALLS.indexOf(wall) >= 0 ? wall : "east",
    offset: offset === null ? 0 : offset,
    door: normalizeDoor(raw.door),
  };
};

/**
 * How strongly a room's tint fills it, as a percentage. `null` means "leave it
 * to the card default", which keeps an untinted plan looking as it always has.
 */
const ROOM_FILL_DEFAULT = 8;

const normalizeFill = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const pct = Number(value);
  if (!Number.isFinite(pct)) return null;
  // A fraction is the other natural way to write this, and anything under 1%
  // would render as nothing anyway, so read 0.4 as 40%.
  return clamp(Math.round(pct > 0 && pct < 1 ? pct * 100 : pct), 0, 100);
};

const normalizeRoom = (raw, index) => {
  const room = { ...(raw || {}) };
  const at = parsePair(room.at !== undefined ? room.at : [room.x, room.y]);
  const rawSize = room.size !== undefined
    ? room.size
    : [room.width, room.depth !== undefined ? room.depth : room.height];
  const size = parsePair(rawSize);
  const width = size ? Math.max(size[0], 0) : 0;
  const depth = size ? Math.max(size[1], 0) : 0;
  // An explicit floor_area covers rooms that are not plain rectangles.
  const stated = Number(room.floor_area);
  return {
    id: room.id || uid("room"),
    name: room.name === undefined ? `Room ${index + 1}` : room.name,
    area: room.area || "",           // optional Home Assistant area id
    x: at ? at[0] : 0,               // only used when the room anchors the plan
    y: at ? at[1] : 0,
    width,
    depth,
    floor_area: Number.isFinite(stated) && stated > 0 ? stated : width * depth,
    attach: normalizeAttach(room.attach),
    devices: (room.devices || []).map(normalizeDevice),
    color: room.color || "",
    fill: normalizeFill(room.fill),
    label: room.label === undefined ? true : Boolean(room.label),
  };
};

const normalizeFloor = (raw, index) => {
  const floor = { ...(raw || {}) };
  const bindings = (floor.svg_bindings || []).map(normalizeBinding).filter((b) => b.selector);
  const size = parsePair(floor.size !== undefined ? floor.size : [floor.width, floor.depth]);
  return {
    id: floor.id || uid("floor"),
    name: floor.name || `Floor ${index + 1}`,
    level: floor.level === undefined ? index : Number(floor.level),
    icon: floor.icon,
    image: floor.image || "",
    image_dark: floor.image_dark || "",
    aspect_ratio: floor.aspect_ratio,
    opacity: floor.opacity,
    inline_svg: floor.inline_svg === undefined ? bindings.length > 0 : Boolean(floor.inline_svg),
    svg_bindings: bindings,
    width: size ? Math.max(size[0], 0) : 0,
    depth: size ? Math.max(size[1], 0) : 0,
    rooms: (floor.rooms || []).map(normalizeRoom),
    markers: (floor.markers || []).map(normalizeMarker),
  };
};

const normalizeConfig = (raw) => {
  const config = { ...(raw || {}) };
  const floors = (config.floors || []).map(normalizeFloor);
  floors.sort((a, b) => b.level - a.level); // top floor first, like a real house
  return {
    type: config.type,
    title: config.title,
    floors,
    selector: config.selector || "tabs", // tabs | dropdown | buttons | none
    default_floor: config.default_floor,
    aspect_ratio: config.aspect_ratio || "",
    marker_size: Number(config.marker_size) || 34,
    color_on: config.color_on || "var(--state-light-active-color, #fdd835)",
    color_off: config.color_off || "var(--secondary-text-color, #727272)",
    show_names: config.show_names === undefined ? false : Boolean(config.show_names),
    show_states: config.show_states === undefined ? true : Boolean(config.show_states),
    allow_zoom: config.allow_zoom === undefined ? true : Boolean(config.allow_zoom),
    stack_view: config.stack_view === undefined ? true : Boolean(config.stack_view),
    stack_default: Boolean(config.stack_default),
    remember_floor: config.remember_floor === undefined ? true : Boolean(config.remember_floor),
    theme_image: Boolean(config.theme_image),
    units: config.units === "metric" || config.units === "imperial" ? config.units : "auto",
    show_rooms: config.show_rooms === undefined ? true : Boolean(config.show_rooms),
    show_room_names: config.show_room_names === undefined ? true : Boolean(config.show_room_names),
    show_room_dimensions:
      config.show_room_dimensions === undefined ? true : Boolean(config.show_room_dimensions),
    show_room_areas: config.show_room_areas === undefined ? true : Boolean(config.show_room_areas),
  };
};

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const CARD_STYLES = `
  :host {
    --hlc-accent: var(--accent-color, #03a9f4);
    --hlc-surface: var(--card-background-color, #fff);
    --hlc-text: var(--primary-text-color, #212121);
    --hlc-muted: var(--secondary-text-color, #727272);
    --hlc-divider: var(--divider-color, rgba(0,0,0,.12));
    --hlc-marker-size: 34px;
    display: block;
  }
  ha-card {
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 4px;
  }
  .title {
    font-size: var(--ha-card-header-font-size, 22px);
    font-weight: 400;
    line-height: 1.2;
    color: var(--ha-card-header-color, var(--hlc-text));
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tools { display: flex; gap: 2px; }
  .tool {
    border: none;
    background: none;
    color: var(--hlc-muted);
    cursor: pointer;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color .15s ease, color .15s ease;
  }
  .tool:hover { background: var(--hlc-divider); color: var(--hlc-text); }
  .tool[aria-pressed="true"] { color: var(--hlc-accent); }

  /* ---- floor selector ---- */
  /* A single minmax(0, 1fr) grid track pins the selector's min-content width to
     zero, so the scrolling tab strip can never widen the whole card. */
  .selector { padding: 4px 12px 0; display: grid; grid-template-columns: minmax(0, 1fr); }
  .tabs {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--hlc-divider);
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    appearance: none;
    border: none;
    background: none;
    font: inherit;
    font-size: 14px;
    color: var(--hlc-muted);
    padding: 10px 14px;
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: color .15s ease, border-color .15s ease;
  }
  .tab:hover { color: var(--hlc-text); }
  .tab[aria-selected="true"] {
    color: var(--hlc-accent);
    border-bottom-color: var(--hlc-accent);
    font-weight: 500;
  }
  .tab .count {
    font-size: 11px;
    background: var(--hlc-divider);
    border-radius: 9px;
    padding: 1px 6px;
    color: var(--hlc-muted);
  }
  .buttons { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 4px; }
  .pill {
    appearance: none;
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--hlc-divider);
    background: transparent;
    color: var(--hlc-muted);
    border-radius: 16px;
    padding: 6px 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .pill[aria-selected="true"] {
    border-color: var(--hlc-accent);
    color: var(--hlc-accent);
    background: color-mix(in srgb, var(--hlc-accent) 12%, transparent);
  }
  select.dropdown {
    font: inherit;
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--hlc-divider);
    background: var(--hlc-surface);
    color: var(--hlc-text);
    margin: 4px 0 8px;
  }

  /* ---- stage ---- */
  .stage {
    position: relative;
    flex: 1;
    padding: 8px 12px 12px;
    overflow: hidden;
    touch-action: pan-y;
  }
  .stage.zoomed { touch-action: none; cursor: grab; }
  .stage.panning { cursor: grabbing; }
  .plans { position: relative; }
  .plan {
    position: relative;
    width: 100%;
    display: none;
    transform-origin: center center;
  }
  .plan.active { display: block; }
  .plan .canvas {
    position: relative;
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
    line-height: 0;
  }
  .plan img.floorplan,
  .plan .svg-host svg {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  .plan.themed img.floorplan { filter: var(--hlc-image-filter, none); }
  .empty-plan {
    border: 2px dashed var(--hlc-divider);
    border-radius: 12px;
    aspect-ratio: 16 / 9;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--hlc-muted);
    font-size: 14px;
    text-align: center;
    padding: 16px;
    line-height: 1.4;
  }
  .broken {
    color: var(--error-color, #db4437);
  }

  /* ---- markers ---- */
  .marker {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    line-height: 1;
    z-index: 2;
    -webkit-tap-highlight-color: transparent;
  }
  .marker:focus-visible { outline: 2px solid var(--hlc-accent); outline-offset: 4px; border-radius: 8px; }
  .marker.hidden { display: none; }
  .marker .puck {
    width: var(--marker-size, var(--hlc-marker-size));
    height: var(--marker-size, var(--hlc-marker-size));
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--hlc-surface);
    color: var(--hlc-muted);
    box-shadow: 0 1px 4px rgba(0,0,0,.28);
    border: 1px solid var(--hlc-divider);
    transition: background-color .2s ease, color .2s ease, box-shadow .2s ease, transform .12s ease;
    --mdc-icon-size: calc(var(--marker-size, var(--hlc-marker-size)) * 0.58);
  }
  .marker:hover .puck { transform: scale(1.08); }
  .marker.on .puck {
    background: var(--marker-color-on, var(--hlc-accent));
    color: var(--hlc-on-text, #1c1c1c);
    border-color: transparent;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--marker-color-on, var(--hlc-accent)) 28%, transparent),
                0 2px 8px rgba(0,0,0,.3);
  }
  .marker.unavailable .puck { opacity: .45; border-style: dashed; }
  .marker .caption {
    background: var(--hlc-surface);
    color: var(--hlc-text);
    border-radius: 10px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 500;
    box-shadow: 0 1px 3px rgba(0,0,0,.22);
    white-space: nowrap;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .marker .caption .sub { color: var(--hlc-muted); font-weight: 400; }

  /* style: dot */
  .marker.style-dot .puck {
    width: calc(var(--marker-size, var(--hlc-marker-size)) * 0.42);
    height: calc(var(--marker-size, var(--hlc-marker-size)) * 0.42);
    box-shadow: 0 0 0 3px var(--hlc-surface);
  }
  /* style: badge + label */
  .marker.style-badge .puck,
  .marker.style-label .puck {
    width: auto;
    height: auto;
    min-height: calc(var(--marker-size, var(--hlc-marker-size)) * 0.8);
    border-radius: 999px;
    padding: 4px 10px 4px 6px;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
  }
  .marker.style-label .puck { padding: 5px 12px; }
  .marker .puck .text { white-space: nowrap; }
  /* style: area */
  .marker.style-area {
    transform: none;
    border-radius: 10px;
    background: color-mix(in srgb, var(--marker-color-on, var(--hlc-accent)) 0%, transparent);
    border: 1.5px solid transparent;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 6px;
    transition: background-color .25s ease, border-color .25s ease;
  }
  .marker.style-area.on {
    background: color-mix(in srgb, var(--marker-color-on, var(--hlc-accent)) 22%, transparent);
    border-color: color-mix(in srgb, var(--marker-color-on, var(--hlc-accent)) 55%, transparent);
  }
  .marker.style-area:hover { background: color-mix(in srgb, var(--hlc-accent) 14%, transparent); }
  .marker.style-area .puck { display: none; }
  .marker.style-area .caption { box-shadow: none; background: transparent; }

  /* ---- stacked (all storeys) view ---- */
  .plans.stacked {
    perspective: 1600px;
    padding: 8px 0;
    display: block;
  }
  .plans.stacked .plan {
    display: block;
    position: absolute;
    inset: 0;
    transition: transform .45s cubic-bezier(.2,.7,.3,1), opacity .3s ease;
    cursor: pointer;
    filter: drop-shadow(0 12px 18px rgba(0,0,0,.28));
  }
  .plans.stacked .plan:first-child { position: relative; }
  .plans.stacked .plan .canvas { pointer-events: none; }
  .plans.stacked .plan.active .canvas { pointer-events: auto; }
  .plans.stacked .plan:not(.active) { opacity: .82; }
  .plans.stacked .plan:hover { opacity: 1; }
  .floor-tag {
    position: absolute;
    left: 0;
    top: 0;
    transform: translateY(-120%);
    font-size: 12px;
    font-weight: 500;
    color: var(--hlc-muted);
    background: var(--hlc-surface);
    border: 1px solid var(--hlc-divider);
    border-radius: 12px;
    padding: 2px 8px;
    display: none;
  }
  .plans.stacked .floor-tag { display: block; }
  .plans.stacked .plan.active .floor-tag { color: var(--hlc-accent); border-color: var(--hlc-accent); }

  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 12px;
    font-size: 12px;
    color: var(--hlc-muted);
    min-height: 16px;
  }
  .hint { flex: 1; }
  .warning {
    padding: 12px 16px;
    color: var(--error-color, #db4437);
    font-size: 14px;
  }

  /* ---- rooms ---- */
  .rooms { position: absolute; inset: 0; pointer-events: none; }
  .room {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--hlc-room-color, var(--hlc-divider));
    background: color-mix(in srgb, var(--hlc-room-color, var(--hlc-accent)) var(--hlc-room-fill, 8%), transparent);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .room-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 2px;
    text-align: center;
    line-height: 1.2;
    color: var(--hlc-text);
  }
  .door {
    position: absolute;
    background: var(--hlc-surface);
    height: 3px;
    transform: translate(0, -1.5px);
  }
  .door.vertical {
    width: 3px;
    height: auto;
    transform: translate(-1.5px, 0);
  }
  .room-name { font-size: 12px; font-weight: 500; }
  .room-dim,
  .room-area { font-size: 10px; color: var(--hlc-muted); font-variant-numeric: tabular-nums; }
  @media (prefers-color-scheme: dark) {
    :host { --hlc-image-filter: invert(0.9) hue-rotate(180deg); }
  }
`;

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

class HomeLayoutCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("home-layout-card-editor");
  }

  static getStubConfig(hass) {
    const lights = hass
      ? Object.keys(hass.states).filter((e) => e.startsWith("light.")).slice(0, 3)
      : [];
    return {
      type: "custom:home-layout-card",
      title: "Home",
      floors: [
        {
          id: "ground",
          name: "Ground Floor",
          level: 0,
          image: "",
          markers: lights.map((entity, i) => ({
            entity,
            x: 30 + i * 20,
            y: 45,
          })),
        },
      ],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._activeFloorId = null;
    this._stacked = false;
    this._built = false;
    this._markers = [];   // { cfg, el, puck, iconEl, textEl, captionEl }
    this._bindings = [];  // { cfg, nodes: [] }
    this._zoom = { scale: 1, x: 0, y: 0 };
    this._pointers = new Map();
    this._svgCache = new Map();
  }

  /* ---------------- lifecycle ---------------- */

  setConfig(config) {
    if (!config || !Array.isArray(config.floors)) {
      throw new Error("home-layout-card: you need to define at least one entry in `floors`");
    }
    if (config.floors.length === 0) {
      throw new Error("home-layout-card: `floors` must contain at least one floor");
    }
    this._config = normalizeConfig(config);
    this._stacked = this._config.stack_view && this._config.stack_default;

    const stored = this._config.remember_floor ? this._readStoredFloor() : null;
    const wanted = this._config.default_floor || stored;
    const match = this._config.floors.find((f) => f.id === wanted || f.name === wanted);
    this._activeFloorId = (match || this._config.floors[0]).id;

    this._built = false;
    this._render();
  }

  set hass(hass) {
    const wasDark = this._hass ? this._isDarkMode() : null;
    this._hass = hass;
    if (!this._built) {
      this._render();
      return;
    }
    // Only a theme flip needs a rebuild, and only if a dark variant exists.
    if (
      wasDark !== null &&
      wasDark !== this._isDarkMode() &&
      this._config.floors.some((f) => f.image_dark)
    ) {
      this._render();
      return;
    }
    // `units: auto` follows Home Assistant, which may only arrive after the first
    // paint — re-label the rooms when the system actually changes under us.
    if (this._renderedUnits && this._renderedUnits !== this._unitSystem()) {
      this._render();
      return;
    }
    this._updateStates();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 8;
  }

  getLayoutOptions() {
    return { grid_columns: 12, grid_rows: 8, grid_min_rows: 4 };
  }

  connectedCallback() {
    if (this._config && !this._built) this._render();
  }

  disconnectedCallback() {
    if (this._fitObserver) {
      this._fitObserver.disconnect();
      this._fitObserver = null;
    }
  }

  /* ---------------- persistence of the selected floor ---------------- */

  _storageKey() {
    const ids = this._config.floors.map((f) => f.id).join("|");
    return `home-layout-card:${this._config.title || "untitled"}:${ids}`;
  }

  _readStoredFloor() {
    try {
      return window.localStorage.getItem(this._storageKey());
    } catch (err) {
      return null;
    }
  }

  _storeFloor(id) {
    if (!this._config.remember_floor) return;
    try {
      window.localStorage.setItem(this._storageKey(), id);
    } catch (err) {
      /* private mode / storage disabled — not fatal */
    }
  }

  /* ---------------- rendering ---------------- */

  _render() {
    if (!this._config) return;
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = CARD_STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    card.style.setProperty("--hlc-marker-size", `${this._config.marker_size}px`);
    root.appendChild(card);

    if (this._config.title || this._config.stack_view || this._config.allow_zoom) {
      card.appendChild(this._buildHeader());
    }
    if (this._config.selector !== "none" && this._config.floors.length > 1) {
      card.appendChild(this._buildSelector());
    }

    this._markers = [];
    this._bindings = [];
    this._layouts = new Map();
    this._renderToken = (this._renderToken || 0) + 1;

    const stage = document.createElement("div");
    stage.className = "stage";
    const plans = document.createElement("div");
    plans.className = "plans";
    stage.appendChild(plans);
    card.appendChild(stage);

    this._stageEl = stage;
    this._plansEl = plans;

    this._config.floors.forEach((floor) => {
      plans.appendChild(this._buildPlan(floor));
    });

    const footer = document.createElement("div");
    footer.className = "footer";
    const hint = document.createElement("div");
    hint.className = "hint";
    footer.appendChild(hint);
    this._hintEl = hint;
    card.appendChild(footer);

    if (this._config.allow_zoom) this._attachZoom(stage);
    this._attachFit(stage);

    this._built = true;
    this._renderedUnits = this._unitSystem();
    this._applyActiveFloor();
    this._updateStates();
  }

  _buildHeader() {
    const header = document.createElement("div");
    header.className = "header";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = this._config.title || "";
    header.appendChild(title);

    const tools = document.createElement("div");
    tools.className = "tools";

    if (this._config.stack_view && this._config.floors.length > 1) {
      const stackBtn = this._toolButton("mdi:layers-triple-outline", "Toggle all-storeys view");
      stackBtn.setAttribute("aria-pressed", String(this._stacked));
      stackBtn.addEventListener("click", () => {
        this._stacked = !this._stacked;
        stackBtn.setAttribute("aria-pressed", String(this._stacked));
        this._resetZoom();
        this._applyActiveFloor();
      });
      tools.appendChild(stackBtn);
      this._stackBtn = stackBtn;
    }

    if (this._config.allow_zoom) {
      const resetBtn = this._toolButton("mdi:fit-to-screen-outline", "Reset zoom");
      resetBtn.addEventListener("click", () => this._resetZoom());
      tools.appendChild(resetBtn);
    }

    header.appendChild(tools);
    return header;
  }

  _toolButton(icon, label) {
    const btn = document.createElement("button");
    btn.className = "tool";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    const ic = document.createElement("ha-icon");
    ic.setAttribute("icon", icon);
    btn.appendChild(ic);
    return btn;
  }

  _buildSelector() {
    const wrap = document.createElement("div");
    wrap.className = "selector";
    const mode = this._config.selector;

    if (mode === "dropdown") {
      const select = document.createElement("select");
      select.className = "dropdown";
      this._config.floors.forEach((floor) => {
        const opt = document.createElement("option");
        opt.value = floor.id;
        opt.textContent = floor.name;
        select.appendChild(opt);
      });
      select.value = this._activeFloorId;
      select.addEventListener("change", () => this._selectFloor(select.value));
      wrap.appendChild(select);
      this._selectEl = select;
      return wrap;
    }

    const list = document.createElement("div");
    list.className = mode === "buttons" ? "buttons" : "tabs";
    list.setAttribute("role", "tablist");

    this._tabEls = [];
    this._config.floors.forEach((floor) => {
      const btn = document.createElement("button");
      btn.className = mode === "buttons" ? "pill" : "tab";
      btn.setAttribute("role", "tab");
      btn.dataset.floor = floor.id;
      btn.setAttribute("aria-selected", String(floor.id === this._activeFloorId));

      if (floor.icon) {
        const ic = document.createElement("ha-icon");
        ic.setAttribute("icon", floor.icon);
        ic.style.setProperty("--mdc-icon-size", "18px");
        btn.appendChild(ic);
      }
      const label = document.createElement("span");
      label.textContent = floor.name;
      btn.appendChild(label);

      const count = document.createElement("span");
      count.className = "count";
      btn.appendChild(count);
      btn._countEl = count;

      btn.addEventListener("click", () => this._selectFloor(floor.id));
      list.appendChild(btn);
      this._tabEls.push(btn);
    });

    wrap.appendChild(list);
    return wrap;
  }

  _buildPlan(floor) {
    const plan = document.createElement("div");
    plan.className = "plan";
    plan.dataset.floor = floor.id;
    if (this._config.theme_image) plan.classList.add("themed");

    const tag = document.createElement("div");
    tag.className = "floor-tag";
    tag.textContent = floor.name;
    plan.appendChild(tag);

    const canvas = document.createElement("div");
    canvas.className = "canvas";
    const ratio = floor.aspect_ratio || this._config.aspect_ratio;
    if (ratio) {
      canvas.style.aspectRatio = String(ratio).replace(":", " / ");
    } else if (!this._floorImage(floor)) {
      // Nothing to give the canvas its shape, so let the rooms' own proportions do it.
      const extent = this._layout(floor).extent;
      if (extent) canvas.style.aspectRatio = `${extent.width} / ${extent.depth}`;
    }
    if (floor.opacity !== undefined) canvas.style.opacity = String(floor.opacity);
    plan.appendChild(canvas);

    plan.addEventListener("click", (ev) => {
      // In the stacked view a click on a non-active storey brings it forward.
      if (this._stacked && floor.id !== this._activeFloorId) {
        ev.stopPropagation();
        this._selectFloor(floor.id);
      }
    });

    const rooms = this._buildRooms(floor);
    const src = this._floorImage(floor);
    if (!src) {
      // Rooms alone are a valid plan — only nag when there is nothing to draw at all.
      if (!rooms) canvas.appendChild(this._emptyPlaceholder(floor));
    } else if (floor.inline_svg) {
      const host = document.createElement("div");
      host.className = "svg-host";
      canvas.appendChild(host);
      this._loadInlineSvg(floor, host, canvas);
    } else {
      const img = document.createElement("img");
      img.className = "floorplan";
      img.alt = `${floor.name} floorplan`;
      img.loading = "lazy";
      img.src = src;
      img.addEventListener("load", () => this._applyFit());
      img.addEventListener("error", () => {
        if (rooms) {
          // The rooms still describe the storey; drop the broken image and keep them.
          img.remove();
          return;
        }
        canvas.innerHTML = "";
        canvas.appendChild(this._emptyPlaceholder(floor, true));
      });
      canvas.appendChild(img);
    }

    if (rooms) canvas.appendChild(rooms);

    floor.markers.concat(this._roomDevices(floor)).forEach((marker) => {
      canvas.appendChild(this._buildMarker(marker, floor));
    });

    return plan;
  }

  _unitSystem() {
    return unitSystemOf(this._config, this._hass);
  }

  /** Solved layouts are reused by the renderer and the state updater. */
  _layout(floor) {
    if (!this._layouts) this._layouts = new Map();
    if (!this._layouts.has(floor.id)) this._layouts.set(floor.id, solveFloorLayout(floor));
    return this._layouts.get(floor.id);
  }

  _buildRooms(floor) {
    if (!this._config.show_rooms || !floor.rooms.length) return null;
    const { boxes, doors, extent, problems } = this._layout(floor);
    if (!extent) return null;

    problems.forEach((problem) => {
      // eslint-disable-next-line no-console
      console.warn(`home-layout-card: ${floor.name}: ${problem}`);
    });

    const layer = document.createElement("div");
    layer.className = "rooms";

    floor.rooms.forEach((room) => {
      const box = boxes.get(room.id);
      if (!box) return;
      const el = document.createElement("div");
      el.className = "room";
      el.dataset.room = room.id;
      el.style.left = `${(box.x / extent.width) * 100}%`;
      el.style.top = `${(box.y / extent.depth) * 100}%`;
      el.style.width = `${(box.width / extent.width) * 100}%`;
      el.style.height = `${(box.depth / extent.depth) * 100}%`;
      if (room.color) el.style.setProperty("--hlc-room-color", room.color);
      if (room.fill !== null) el.style.setProperty("--hlc-room-fill", `${room.fill}%`);
      if (room.label) {
        const label = this._roomLabel(room);
        if (label) el.appendChild(label);
      }
      layer.appendChild(el);
    });

    // Doors are drawn over the wall they pierce, in the card's own background,
    // so a shared wall reads as an opening rather than two rooms touching.
    doors.forEach((door) => {
      const el = document.createElement("div");
      el.className = `door${door.vertical ? " vertical" : ""}`;
      if (door.vertical) {
        el.style.left = `${(door.x1 / extent.width) * 100}%`;
        el.style.top = `${(door.y1 / extent.depth) * 100}%`;
        el.style.height = `${((door.y2 - door.y1) / extent.depth) * 100}%`;
      } else {
        el.style.left = `${(door.x1 / extent.width) * 100}%`;
        el.style.top = `${(door.y1 / extent.depth) * 100}%`;
        el.style.width = `${((door.x2 - door.x1) / extent.width) * 100}%`;
      }
      layer.appendChild(el);
    });

    return layer.children.length ? layer : null;
  }

  /** Every device across every room, flattened into marker configs. */
  _roomDevices(floor) {
    const { boxes, extent } = this._layout(floor);
    if (!extent) return [];
    const markers = [];
    floor.rooms.forEach((room) => {
      const box = boxes.get(room.id);
      if (box && room.devices.length) markers.push(...roomDeviceMarkers(room, box, extent));
    });
    return markers;
  }

  _roomLabel(room) {
    const system = this._unitSystem();
    const box = document.createElement("div");
    box.className = "room-label";

    if (this._config.show_room_names && room.name) {
      const name = document.createElement("span");
      name.className = "room-name";
      name.textContent = room.name;
      box.appendChild(name);
    }
    if (this._config.show_room_dimensions) {
      const dim = document.createElement("span");
      dim.className = "room-dim";
      dim.textContent = `${formatLength(room.width, system)} \u00d7 ${formatLength(room.depth, system)}`;
      box.appendChild(dim);
    }
    if (this._config.show_room_areas) {
      const area = document.createElement("span");
      area.className = "room-area";
      area.textContent = formatArea(room.floor_area, system);
      box.appendChild(area);
    }
    return box.children.length ? box : null;
  }

  /** Width/height the plan wants, from an explicit ratio, the image, or the rooms. */
  _planRatio(floor) {
    const raw = floor.aspect_ratio || this._config.aspect_ratio;
    if (raw) {
      const parts = String(raw).split(/[:/]/);
      const w = Number(parts[0]);
      const h = Number(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
    if (this._floorImage(floor) && this._plansEl) {
      const img = this._plansEl.querySelector(`.plan[data-floor="${floor.id}"] img.floorplan`);
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) return img.naturalWidth / img.naturalHeight;
      const svg = this._plansEl.querySelector(`.plan[data-floor="${floor.id}"] .svg-host svg`);
      const view = svg && svg.viewBox && svg.viewBox.baseVal;
      if (view && view.width > 0 && view.height > 0) return view.width / view.height;
    }
    const extent = this._layout(floor).extent;
    return extent ? extent.width / extent.depth : null;
  }

  /**
   * Size each plan so the whole thing is visible inside the card, letterboxed
   * rather than cropped. Only ever shrinks: when the card is tall enough the
   * plan just fills the width, which keeps this from fighting a card whose
   * height is decided by its content.
   */
  _applyFit() {
    const stage = this._stageEl;
    if (!stage || !this._plansEl) return;
    const style = window.getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    const availH = stage.clientHeight - parseFloat(style.paddingTop || 0) - parseFloat(style.paddingBottom || 0);
    if (!(availW > 0)) return;

    this._config.floors.forEach((floor) => {
      const plan = this._plansEl.querySelector(`.plan[data-floor="${floor.id}"]`);
      const canvas = plan && plan.querySelector(".canvas");
      if (!canvas) return;
      const ratio = this._planRatio(floor);
      if (!ratio) {
        canvas.style.width = "";
        return;
      }
      const wanted = availW / ratio;
      const width = availH > 0 && wanted > availH + 1 ? availH * ratio : availW;
      canvas.style.width = `${Math.max(Math.round(width), 1)}px`;
    });
  }

  _attachFit(stage) {
    if (this._fitObserver) this._fitObserver.disconnect();
    this._applyFit();
    if (typeof ResizeObserver === "undefined") return;
    this._fitObserver = new ResizeObserver(() => this._applyFit());
    this._fitObserver.observe(stage);
  }

  _floorImage(floor) {
    if (floor.image_dark && this._isDarkMode()) return floor.image_dark;
    return floor.image;
  }

  _isDarkMode() {
    if (this._hass && this._hass.themes && this._hass.themes.darkMode !== undefined) {
      return Boolean(this._hass.themes.darkMode);
    }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  _emptyPlaceholder(floor, broken) {
    const box = document.createElement("div");
    box.className = `empty-plan${broken ? " broken" : ""}`;
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", broken ? "mdi:image-broken-variant" : "mdi:floor-plan");
    icon.style.setProperty("--mdc-icon-size", "40px");
    box.appendChild(icon);
    const text = document.createElement("div");
    text.textContent = broken
      ? `Could not load "${this._floorImage(floor)}" for ${floor.name}.`
      : `No floorplan image set for ${floor.name}. Add one in the card editor (e.g. /local/floorplans/${floor.id}.svg).`;
    box.appendChild(text);
    return box;
  }

  async _loadInlineSvg(floor, host, canvas) {
    const src = this._floorImage(floor);
    const token = this._renderToken;
    try {
      let markup = this._svgCache.get(src);
      if (!markup) {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        markup = await response.text();
        this._svgCache.set(src, markup);
      }
      if (token !== this._renderToken) return; // a newer render superseded this fetch
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg || doc.querySelector("parsererror")) throw new Error("not an SVG document");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      host.innerHTML = "";
      host.appendChild(document.importNode(svg, true));
      this._wireBindings(floor, host);
      this._applyFit();
      this._updateStates();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`home-layout-card: inline SVG for "${floor.name}" failed (${err.message}); falling back to <img>`);
      if (token !== this._renderToken) return;
      host.remove();
      const img = document.createElement("img");
      img.className = "floorplan";
      img.alt = `${floor.name} floorplan`;
      img.src = src;
      canvas.insertBefore(img, canvas.firstChild);
    }
  }

  _wireBindings(floor, host) {
    floor.svg_bindings.forEach((binding) => {
      let nodes = [];
      try {
        nodes = Array.from(host.querySelectorAll(binding.selector));
        if (!nodes.length) {
          // Allow a bare id such as "kitchen" as well as "#kitchen"
          nodes = Array.from(host.querySelectorAll(`#${CSS.escape(binding.selector)}`));
        }
      } catch (err) {
        nodes = [];
      }
      if (!nodes.length) {
        // eslint-disable-next-line no-console
        console.warn(`home-layout-card: no SVG element matched "${binding.selector}" on ${floor.name}`);
        return;
      }
      nodes.forEach((node) => {
        node.style.transition = "fill .25s ease, fill-opacity .25s ease";
        if (binding.entity && binding.tap_action && binding.tap_action.action !== "none") {
          node.style.cursor = "pointer";
          node.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this._handleAction(binding.tap_action, binding.entity);
          });
        }
      });
      this._bindings.push({ cfg: binding, nodes });
    });
  }

  _buildMarker(cfg, floor) {
    const el = document.createElement("div");
    el.className = `marker style-${cfg.style}`;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.dataset.marker = cfg.id;
    el.style.left = `${cfg.x}%`;
    el.style.top = `${cfg.y}%`;
    if (cfg.size) el.style.setProperty("--marker-size", `${cfg.size}px`);
    el.style.setProperty("--marker-color-on", cfg.color_on || this._config.color_on);
    if (cfg.style === "area") {
      el.style.width = `${cfg.width === undefined ? 20 : cfg.width}%`;
      el.style.height = `${cfg.height === undefined ? 20 : cfg.height}%`;
    }

    const puck = document.createElement("div");
    puck.className = "puck";
    const iconEl = this._createIconElement();
    puck.appendChild(iconEl);

    const textEl = document.createElement("span");
    textEl.className = "text";
    puck.appendChild(textEl);
    el.appendChild(puck);

    const captionEl = document.createElement("div");
    captionEl.className = "caption";
    el.appendChild(captionEl);

    const record = { cfg, floor, el, puck, iconEl, textEl, captionEl };
    this._attachGestures(el, cfg);
    this._markers.push(record);
    return el;
  }

  /**
   * `ha-state-icon` follows the entity's own icon, device class and state.
   * It is not guaranteed to be registered in every HA build, so fall back
   * to a plain `ha-icon` with our own domain map.
   */
  _createIconElement() {
    if (customElements.get("ha-state-icon")) {
      return document.createElement("ha-state-icon");
    }
    return document.createElement("ha-icon");
  }

  _attachGestures(el, cfg) {
    let holdTimer = null;
    let held = false;
    let lastTap = 0;
    const hasDouble = cfg.double_tap_action && cfg.double_tap_action.action !== "none";

    const start = () => {
      held = false;
      if (cfg.hold_action && cfg.hold_action.action !== "none") {
        holdTimer = window.setTimeout(() => {
          held = true;
          this._handleAction(cfg.hold_action, cfg.entity);
        }, 500);
      }
    };
    const cancel = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = null;
    };

    el.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); start(); });
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);

    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      cancel();
      if (held) { held = false; return; }
      if (hasDouble) {
        const now = Date.now();
        if (now - lastTap < 280) {
          lastTap = 0;
          this._handleAction(cfg.double_tap_action, cfg.entity);
          return;
        }
        lastTap = now;
        window.setTimeout(() => {
          if (lastTap) {
            lastTap = 0;
            this._handleAction(cfg.tap_action, cfg.entity);
          }
        }, 280);
        return;
      }
      this._handleAction(cfg.tap_action, cfg.entity);
    });

    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this._handleAction(cfg.tap_action, cfg.entity);
      }
    });
  }

  /* ---------------- state updates ---------------- */

  _updateStates() {
    if (!this._hass || !this._built) return;
    const hass = this._hass;
    const states = hass.states || {};

    this._markers.forEach((m) => {
      const { cfg, el, puck, iconEl, textEl, captionEl } = m;
      const stateObj = cfg.entity ? states[cfg.entity] : undefined;
      const active = isActive(stateObj);
      const missing = cfg.entity && !stateObj;

      el.classList.toggle("on", active);
      el.classList.toggle("unavailable", isUnavailable(stateObj) || Boolean(missing));
      el.classList.toggle("hidden", cfg.hide_when_off && !active);

      const colorOff = cfg.color_off || this._config.color_off;
      puck.style.color = active ? "" : colorOff;

      // icon
      if (iconEl.localName === "ha-state-icon") {
        iconEl.hass = hass;
        iconEl.stateObj = stateObj;
        if (cfg.icon) iconEl.icon = cfg.icon;
      } else {
        iconEl.setAttribute("icon", cfg.icon || fallbackIcon(cfg.entity, stateObj));
      }
      iconEl.style.display = cfg.style === "label" ? "none" : "";

      // inline text (badge / label styles)
      const name = cfg.name || friendlyName(cfg.entity, stateObj);
      if (cfg.style === "badge") {
        textEl.textContent = missing ? "?" : compactState(hass, stateObj);
        textEl.style.display = "";
      } else if (cfg.style === "label") {
        textEl.textContent = name;
        textEl.style.display = "";
      } else {
        textEl.textContent = "";
        textEl.style.display = "none";
      }

      // caption under the puck
      const showName = cfg.show_name === undefined ? this._config.show_names : cfg.show_name;
      const showState = cfg.show_state === undefined ? this._config.show_states : cfg.show_state;
      const captionParts = [];
      if (cfg.style === "area") {
        if (showName !== false) captionParts.push(name);
        if (showState && stateObj) captionParts.push(compactState(hass, stateObj));
      } else {
        if (showName && cfg.style !== "label") captionParts.push(name);
        if (showState && cfg.style !== "badge" && stateObj) {
          captionParts.push(compactState(hass, stateObj));
        }
      }
      if (missing) captionParts.push("entity not found");

      if (captionParts.length) {
        captionEl.style.display = "";
        captionEl.textContent = "";
        captionParts.forEach((part, i) => {
          const span = document.createElement("span");
          if (i > 0) span.className = "sub";
          span.textContent = (i > 0 ? " · " : "") + part;
          captionEl.appendChild(span);
        });
      } else {
        captionEl.style.display = "none";
      }

      el.title = cfg.entity ? `${name}: ${formatState(hass, stateObj)}` : name;
      el.setAttribute("aria-label", el.title);
    });

    // SVG room fills
    this._bindings.forEach(({ cfg, nodes }) => {
      const stateObj = cfg.entity ? states[cfg.entity] : undefined;
      const active = isActive(stateObj);
      const fill = active
        ? cfg.color_on || this._config.color_on
        : cfg.color_off || "";
      const opacity = active
        ? cfg.opacity_on === undefined ? 0.45 : cfg.opacity_on
        : cfg.opacity_off;
      nodes.forEach((node) => {
        if (fill) {
          node.style.fill = fill;
          node.style.fillOpacity = String(opacity === undefined ? 1 : opacity);
        } else {
          // Nothing configured for this state: hand the shape back to the SVG's own styling.
          node.style.removeProperty("fill");
          if (opacity === undefined) node.style.removeProperty("fill-opacity");
          else node.style.fillOpacity = String(opacity);
        }
      });
    });

    this._updateTabCounts();
  }

  _updateTabCounts() {
    if (!this._tabEls || !this._hass) return;
    this._tabEls.forEach((tab) => {
      const floor = this._config.floors.find((f) => f.id === tab.dataset.floor);
      if (!floor || !tab._countEl) return;
      const states = this._hass.states || {};
      const on = floor.markers.filter((m) => isActive(states[m.entity])).length;
      tab._countEl.textContent = on > 0 ? String(on) : "";
      tab._countEl.style.display = on > 0 ? "" : "none";
    });
  }

  /* ---------------- floors ---------------- */

  _selectFloor(id) {
    if (id === this._activeFloorId && !this._stacked) return;
    this._activeFloorId = id;
    this._storeFloor(id);
    this._resetZoom();
    this._applyActiveFloor();
  }

  _applyActiveFloor() {
    if (!this._plansEl) return;
    const plans = Array.from(this._plansEl.querySelectorAll(".plan"));
    this._plansEl.classList.toggle("stacked", this._stacked);

    plans.forEach((plan) => {
      plan.classList.toggle("active", plan.dataset.floor === this._activeFloorId);
      plan.style.transform = "";
      plan.style.zIndex = "";
    });

    if (this._stacked) {
      // Stack the storeys in an isometric-ish pile, highest floor on top.
      const count = plans.length;
      const spread = clamp(260 / Math.max(count, 1), 55, 110);
      plans.forEach((plan, i) => {
        const offset = (count - 1) / 2 - i;
        plan.style.transform =
          `rotateX(56deg) rotateZ(-38deg) translate3d(0, 0, ${round2(offset * spread)}px) scale(.78)`;
        plan.style.zIndex = String(count - i);
      });
      this._plansEl.style.minHeight = `${plans.length * 42 + 200}px`;
    } else {
      this._plansEl.style.minHeight = "";
    }

    if (this._tabEls) {
      this._tabEls.forEach((tab) =>
        tab.setAttribute("aria-selected", String(tab.dataset.floor === this._activeFloorId))
      );
    }
    if (this._selectEl) this._selectEl.value = this._activeFloorId;
    if (this._stackBtn) this._stackBtn.setAttribute("aria-pressed", String(this._stacked));

    if (this._hintEl) {
      const floor = this._config.floors.find((f) => f.id === this._activeFloorId);
      this._hintEl.textContent = this._stacked
        ? "All storeys — tap one to open it"
        : floor && this._config.selector === "none"
        ? floor.name
        : "";
    }
  }

  /* ---------------- zoom & pan ---------------- */

  _attachZoom(stage) {
    const apply = () => {
      const { scale, x, y } = this._zoom;
      const plan = this._plansEl.querySelector(".plan.active");
      if (!plan) return;
      plan.style.transform =
        scale === 1 && x === 0 && y === 0
          ? ""
          : `translate(${round2(x)}px, ${round2(y)}px) scale(${round2(scale)})`;
      stage.classList.toggle("zoomed", scale !== 1);
    };
    this._applyZoom = apply;

    /**
     * Scale about a point on screen, so whatever is under the fingers stays
     * under them. The transform is `translate(t) scale(s)` about the centre,
     * so a point u (measured from the untransformed centre) sits at u*s + t;
     * holding it still across a scale change gives t1 = u - (u - t0) * s1/s0.
     */
    const zoomAround = (factor, clientX, clientY) => {
      const from = this._zoom.scale;
      const to = clamp(from * factor, 1, 5);
      if (to === from) return;
      if (to === 1) {
        this._zoom = { scale: 1, x: 0, y: 0 };
        apply();
        return;
      }
      const plan = this._plansEl.querySelector(".plan.active");
      if (!plan) return;
      const rect = plan.getBoundingClientRect();
      const ux = clientX - (rect.left + rect.width / 2 - this._zoom.x);
      const uy = clientY - (rect.top + rect.height / 2 - this._zoom.y);
      const k = to / from;
      this._zoom = {
        scale: to,
        x: ux - (ux - this._zoom.x) * k,
        y: uy - (uy - this._zoom.y) * k,
      };
      apply();
    };
    this._zoomAround = zoomAround;

    stage.addEventListener("wheel", (ev) => {
      if (this._stacked) return;
      // A trackpad pinch arrives as ctrl+wheel. A plain wheel is the user
      // scrolling the dashboard, so let it through instead of swallowing it --
      // a card that eats the scroll makes the page feel broken.
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      // A pinch is a stream of small deltas, so scale continuously with the
      // gesture. Fixed percentage steps would jump straight to the limit.
      zoomAround(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
    }, { passive: false });


    stage.addEventListener("pointerdown", (ev) => {
      if (this._stacked || this._zoom.scale === 1) return;
      try { stage.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic pointer */ }
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", (ev) => {
      const start = this._pointers.get(ev.pointerId);
      if (!start) return;
      this._zoom.x += ev.clientX - start.x;
      this._zoom.y += ev.clientY - start.y;
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      apply();
    });
    const endPan = (ev) => {
      this._pointers.delete(ev.pointerId);
      stage.classList.remove("panning");
    };
    stage.addEventListener("pointerup", endPan);
    stage.addEventListener("pointercancel", endPan);
    stage.addEventListener("dblclick", () => this._resetZoom());
  }

  _resetZoom() {
    this._zoom = { scale: 1, x: 0, y: 0 };
    if (this._applyZoom) this._applyZoom();
    if (this._plansEl) {
      this._plansEl.querySelectorAll(".plan").forEach((p) => {
        if (!this._stacked) p.style.transform = "";
      });
    }
  }

  /* ---------------- actions ---------------- */

  _handleAction(action, entityId) {
    const cfg = action || { action: "more-info" };
    const hass = this._hass;
    switch (cfg.action) {
      case "none":
        return;
      case "toggle":
        if (!entityId || !hass) return;
        hass.callService("homeassistant", "toggle", { entity_id: entityId });
        return;
      case "navigate":
        if (!cfg.navigation_path) return;
        history.pushState(null, "", cfg.navigation_path);
        fireEvent(window, "location-changed", {});
        return;
      case "url":
        if (cfg.url_path) window.open(cfg.url_path, cfg.url_path.startsWith("http") ? "_blank" : "_self");
        return;
      case "call-service":
      case "perform-action": {
        const target = cfg.perform_action || cfg.service;
        if (!target || !hass) return;
        const [domain, service] = target.split(".");
        hass.callService(domain, service, cfg.data || cfg.service_data || {}, cfg.target);
        return;
      }
      case "more-info":
      default:
        if (!entityId) return;
        fireEvent(this, "hass-more-info", { entityId });
    }
  }
}

customElements.define("home-layout-card", HomeLayoutCard);

/* ------------------------------------------------------------------ *
 * Visual editor
 * ------------------------------------------------------------------ */

const EDITOR_STYLES = `
  :host { display: block; color: var(--primary-text-color); }
  .section {
    border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    border-radius: 12px;
    padding: 12px;
    margin-bottom: 14px;
  }
  .section > h4 {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--secondary-text-color);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section > h4 .grow { flex: 1; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }
  label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); }
  label.field > span { padding-left: 2px; }
  input[type="text"], input[type="number"], select, textarea {
    font: inherit;
    font-size: 14px;
    color: var(--primary-text-color);
    background: var(--secondary-background-color, #f5f5f5);
    border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    border-radius: 8px;
    padding: 8px 10px;
    width: 100%;
    box-sizing: border-box;
  }
  input[type="color"] { width: 42px; height: 34px; padding: 2px; border-radius: 8px; border: 1px solid var(--divider-color); background: none; }
  input:focus, select:focus { outline: 2px solid var(--accent-color, #03a9f4); outline-offset: -1px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row.wrap { flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  button.btn {
    font: inherit;
    font-size: 13px;
    border-radius: 8px;
    border: 1px solid var(--divider-color, rgba(0,0,0,.12));
    background: var(--secondary-background-color, #f5f5f5);
    color: var(--primary-text-color);
    padding: 7px 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  button.btn:hover { border-color: var(--accent-color, #03a9f4); }
  button.btn.primary { background: var(--accent-color, #03a9f4); color: #fff; border-color: transparent; }
  button.btn.danger { color: var(--error-color, #db4437); }
  button.icon {
    border: none; background: none; cursor: pointer; color: var(--secondary-text-color);
    width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  }
  button.icon:hover { background: var(--divider-color); color: var(--primary-text-color); }
  button.icon[disabled] { opacity: .3; cursor: default; }

  .floor-row {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent;
  }
  .floor-row:hover { background: var(--secondary-background-color, #f5f5f5); }
  .floor-row[data-selected="true"] {
    border-color: var(--accent-color, #03a9f4);
    background: color-mix(in srgb, var(--accent-color, #03a9f4) 10%, transparent);
  }
  .floor-row .nm { flex: 1; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .floor-row .lvl { font-size: 11px; color: var(--secondary-text-color); background: var(--divider-color); border-radius: 8px; padding: 1px 7px; }

  .preview-wrap { position: relative; margin-top: 10px; border-radius: 10px; overflow: hidden; background: var(--secondary-background-color, #f5f5f5); }
  .preview-wrap.placing { cursor: crosshair; outline: 2px dashed var(--accent-color, #03a9f4); outline-offset: -2px; }
  .preview-wrap img { display: block; width: 100%; height: auto; }
  .preview-empty {
    aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center;
    color: var(--secondary-text-color); font-size: 13px; text-align: center; padding: 16px;
  }
  .dot {
    position: absolute; transform: translate(-50%, -50%);
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--card-background-color, #fff);
    border: 2px solid var(--accent-color, #03a9f4);
    box-shadow: 0 1px 4px rgba(0,0,0,.3);
    display: flex; align-items: center; justify-content: center;
    cursor: grab; touch-action: none;
    --mdc-icon-size: 15px;
    color: var(--accent-color, #03a9f4);
  }
  .dot[data-selected="true"] { background: var(--accent-color, #03a9f4); color: #fff; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-color,#03a9f4) 30%, transparent); }
  .dot.dragging { cursor: grabbing; }
  .dot .num { position: absolute; top: -8px; right: -8px; font-size: 9px; background: var(--primary-text-color); color: var(--card-background-color); border-radius: 8px; padding: 0 4px; }

  .marker-card { border: 1px solid var(--divider-color); border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
  .marker-card[data-selected="true"] { border-color: var(--accent-color, #03a9f4); }
  .marker-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
  .marker-head .idx { font-size: 11px; color: var(--secondary-text-color); width: 18px; text-align: center; }
  .marker-head .ttl { flex: 1; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .marker-head .pos { font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .marker-body { padding: 0 10px 10px; display: none; }
  .marker-card[data-open="true"] .marker-body { display: block; }
  .hint { font-size: 12px; color: var(--secondary-text-color); margin: 6px 2px 0; line-height: 1.45; }
  .empty-hint { font-size: 13px; color: var(--secondary-text-color); padding: 8px 2px; }
  ha-entity-picker, ha-icon-picker { display: block; width: 100%; }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; }
  .swatch {
    width: 26px; height: 26px; padding: 0; border-radius: 50%;
    border: 2px solid transparent;
    box-shadow: inset 0 0 0 1px var(--divider-color, rgba(0,0,0,.25));
    background-clip: padding-box;
    cursor: pointer;
  }
  .swatch:hover { box-shadow: inset 0 0 0 1px var(--primary-text-color); }
  .swatch[aria-pressed="true"] { border-color: var(--primary-text-color); }
  .swatch.none {
    background: var(--card-background-color, #fff);
    color: var(--secondary-text-color);
    display: inline-flex; align-items: center; justify-content: center;
    --mdc-icon-size: 16px;
  }
  .tint-chip {
    width: 12px; height: 12px; border-radius: 3px; flex: none;
    border: 1px solid var(--divider-color, rgba(0,0,0,.25));
  }
  .fill-row { display: flex; align-items: center; gap: 8px; }
  .fill-row input[type="range"] { flex: 1; width: auto; min-width: 0; padding: 0; accent-color: var(--accent-color, #03a9f4); }
  .fill-row .val {
    font-size: 12px; color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums; min-width: 34px; text-align: right;
  }
  .room-box {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--room-tint, var(--accent-color, #03a9f4));
    background: color-mix(in srgb, var(--room-tint, var(--accent-color, #03a9f4)) var(--room-fill, 12%), transparent);
    border-radius: 3px;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    touch-action: none;
  }
  .room-box[data-selected="true"] {
    border-width: 2px;
    background: color-mix(in srgb, var(--room-tint, var(--accent-color, #03a9f4)) calc(var(--room-fill, 12%) + 14%), transparent);
  }
  .room-box.dragging { cursor: grabbing; }
  /* While placing a marker the rooms would otherwise eat the click. */
  .preview-wrap.placing .room-box { pointer-events: none; }
  .room-box-label {
    font-size: 10px;
    line-height: 1.25;
    text-align: center;
    white-space: pre-line;
    padding: 2px;
    pointer-events: none;
    color: var(--primary-text-color);
  }
  .device-dot {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, rgba(0,0,0,.2));
    box-shadow: 0 1px 3px rgba(0,0,0,.2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
    color: var(--primary-text-color);
  }
  .device-dot ha-icon { --mdc-icon-size: 14px; }
  .room-resize {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--accent-color, #03a9f4);
    border: 2px solid var(--card-background-color, #fff);
    cursor: nwse-resize;
    touch-action: none;
  }
`;

/** HA lazy-loads its form controls; poke the entities-card editor to load them. */
const loadHaComponents = async () => {
  if (customElements.get("ha-entity-picker") && customElements.get("ha-icon-picker")) return;
  if (!window.loadCardHelpers) return;
  try {
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: "entities", entities: [] });
    if (card && card.constructor.getConfigElement) await card.constructor.getConfigElement();
  } catch (err) {
    /* fall back to plain inputs */
  }
};

const MARKER_STYLES = [
  ["icon", "Icon puck"],
  ["badge", "Icon + state"],
  ["label", "Text label"],
  ["dot", "Small dot"],
  ["area", "Room area (highlight)"],
];

/**
 * A tint has to read as a room on a plan, not as a highlight, so these are
 * mid-tones that survive being mixed down to a few percent against either a
 * light or a dark card background.
 */
const ROOM_COLORS = [
  ["#ef5350", "Red"],
  ["#ff7043", "Orange"],
  ["#ffca28", "Amber"],
  ["#9ccc65", "Green"],
  ["#26a69a", "Teal"],
  ["#29b6f6", "Blue"],
  ["#5c6bc0", "Indigo"],
  ["#ab47bc", "Purple"],
  ["#8d6e63", "Brown"],
  ["#78909c", "Slate"],
];

const TAP_ACTIONS = [
  ["more-info", "More info"],
  ["toggle", "Toggle"],
  ["navigate", "Navigate"],
  ["call-service", "Call service"],
  ["none", "Nothing"],
];

class HomeLayoutCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._floorIndex = 0;
    this._openMarker = null;
    this._openRoom = null;
    this._placing = false;
    this._ready = false;
    loadHaComponents().then(() => {
      this._ready = true;
      if (this._config) this._render();
    });
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (incoming === this._lastEmitted) return; // our own change coming back
    this._config = normalizeConfig(config);
    this._floorIndex = clamp(this._floorIndex, 0, Math.max(this._config.floors.length - 1, 0));
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._config) this._render();
    else this._refreshHassOnPickers();
  }

  get hass() {
    return this._hass;
  }

  get _floor() {
    return this._config.floors[this._floorIndex];
  }

  _refreshHassOnPickers() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("ha-entity-picker, ha-icon-picker").forEach((el) => {
      el.hass = this._hass;
    });
  }

  /* ---------------- config plumbing ---------------- */

  _emit(rerender) {
    // Deep copy, not a spread. The editor mutates its own config in place, so
    // anything handed out by reference keeps changing under Home Assistant --
    // it would then see no difference on the next edit and ignore it, and only
    // the first change of a session would ever stick.
    const out = JSON.parse(JSON.stringify({ ...this._config, type: "custom:home-layout-card" }));
    this._lastEmitted = JSON.stringify(out);
    fireEvent(this, "config-changed", { config: out });
    if (rerender) this._render();
  }

  /* ---------------- generic controls ---------------- */

  _field(labelText, control) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(control);
    return label;
  }

  _input(type, value, onChange, opts = {}) {
    const input = document.createElement("input");
    input.type = type;
    if (value !== undefined && value !== null) input.value = value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.min !== undefined) input.min = opts.min;
    if (opts.max !== undefined) input.max = opts.max;
    if (opts.step !== undefined) input.step = opts.step;
    input.addEventListener("change", () => onChange(input.value));
    // `lazy` fields hold off until the value settles, for changes that force a
    // re-render. They also commit on blur: `change` does not always fire, and a
    // value that was typed but never committed is silently lost on save.
    if (type !== "color" && !opts.lazy) {
      input.addEventListener("input", () => onChange(input.value));
    }
    if (opts.lazy) {
      input.addEventListener("blur", () => onChange(input.value));
    }
    return input;
  }

  _select(options, value, onChange) {
    const select = document.createElement("select");
    options.forEach(([val, text]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = text;
      select.appendChild(opt);
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  _checkbox(labelText, checked, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "row";
    wrap.style.fontSize = "13px";
    wrap.style.cursor = "pointer";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = Boolean(checked);
    box.style.width = "auto";
    box.addEventListener("change", () => onChange(box.checked));
    wrap.appendChild(box);
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.appendChild(span);
    return wrap;
  }

  _entityControl(value, onChange) {
    if (customElements.get("ha-entity-picker")) {
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.value = value || "";
      picker.allowCustomEntity = true;
      picker.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        onChange(ev.detail.value || "");
      });
      return picker;
    }
    const input = this._input("text", value, onChange, { placeholder: "light.kitchen" });
    if (this._hass) {
      const listId = uid("entities");
      const list = document.createElement("datalist");
      list.id = listId;
      Object.keys(this._hass.states).sort().forEach((id) => {
        const opt = document.createElement("option");
        opt.value = id;
        list.appendChild(opt);
      });
      input.setAttribute("list", listId);
      const holder = document.createElement("div");
      holder.appendChild(input);
      holder.appendChild(list);
      return holder;
    }
    return input;
  }

  _iconControl(value, onChange) {
    if (customElements.get("ha-icon-picker")) {
      const picker = document.createElement("ha-icon-picker");
      picker.hass = this._hass;
      picker.value = value || "";
      picker.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        onChange(ev.detail.value || "");
      });
      return picker;
    }
    return this._input("text", value, onChange, { placeholder: "mdi:lightbulb" });
  }

  _iconBtn(icon, label, onClick, disabled) {
    const btn = document.createElement("button");
    btn.className = "icon";
    btn.type = "button";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    if (disabled) btn.disabled = true;
    const ic = document.createElement("ha-icon");
    ic.setAttribute("icon", icon);
    btn.appendChild(ic);
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(); });
    return btn;
  }

  _button(icon, text, onClick, className) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn${className ? ` ${className}` : ""}`;
    if (icon) {
      const ic = document.createElement("ha-icon");
      ic.setAttribute("icon", icon);
      ic.style.setProperty("--mdc-icon-size", "18px");
      btn.appendChild(ic);
    }
    btn.appendChild(document.createTextNode(text));
    btn.addEventListener("click", onClick);
    return btn;
  }

  _section(title, extra) {
    const section = document.createElement("div");
    section.className = "section";
    const h = document.createElement("h4");
    const span = document.createElement("span");
    span.className = "grow";
    span.textContent = title;
    h.appendChild(span);
    if (extra) h.appendChild(extra);
    section.appendChild(h);
    return section;
  }

  /* ---------------- render ---------------- */

  _render() {
    if (!this._config) return;
    const root = this.shadowRoot;
    const scroll = root.host.parentElement ? root.host.parentElement.scrollTop : 0;

    // A field that re-renders on every keystroke would otherwise lose focus
    // after the first character, which reads as "typing doesn't work".
    const fields = () => Array.from(root.querySelectorAll("input, select, textarea"));
    const active = root.activeElement;
    let restore = null;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
      let start = null;
      let end = null;
      try { start = active.selectionStart; end = active.selectionEnd; } catch (err) { /* number/colour input */ }
      restore = { index: fields().indexOf(active), start, end };
    }

    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    root.appendChild(style);

    root.appendChild(this._renderCardSection());
    root.appendChild(this._renderFloorsSection());
    if (this._floor) {
      root.appendChild(this._renderFloorDetail());
      root.appendChild(this._renderRoomsSection());
      root.appendChild(this._renderMarkersSection());
      if (this._floor.inline_svg) root.appendChild(this._renderBindingsSection());
    }

    if (root.host.parentElement) root.host.parentElement.scrollTop = scroll;

    if (this._scrollToRoom) {
      // Otherwise the new room lands below the fold and the button looks dead.
      const card = root.querySelector(`.room-card[data-room="${this._scrollToRoom}"]`);
      this._scrollToRoom = null;
      if (card && card.scrollIntoView) card.scrollIntoView({ block: "nearest" });
    }

    if (restore && restore.index >= 0) {
      const next = fields()[restore.index];
      if (next) {
        next.focus();
        if (restore.start !== null) {
          try { next.setSelectionRange(restore.start, restore.end); } catch (err) { /* not selectable */ }
        }
      }
    }
  }

  _renderCardSection() {
    const section = this._section("Card");
    const grid = document.createElement("div");
    grid.className = "grid";

    grid.appendChild(this._field("Title", this._input("text", this._config.title || "", (v) => {
      this._config.title = v || undefined;
      this._emit();
    }, { placeholder: "Home" })));

    grid.appendChild(this._field("Floor selector", this._select(
      [["tabs", "Tabs"], ["buttons", "Pills"], ["dropdown", "Dropdown"], ["none", "Hidden"]],
      this._config.selector,
      (v) => { this._config.selector = v; this._emit(true); }
    )));

    grid.appendChild(this._field("Marker size (px)", this._input("number", this._config.marker_size, (v) => {
      this._config.marker_size = Number(v) || 34;
      this._emit();
    }, { min: 16, max: 80, step: 1 })));

    grid.appendChild(this._field("Aspect ratio", this._input("text", this._config.aspect_ratio, (v) => {
      this._config.aspect_ratio = v;
      this._emit();
    }, { placeholder: "auto, or 16:9" })));

    grid.appendChild(this._field("Units", this._select(
      [
        ["auto", "Follow Home Assistant"],
        ["metric", "Metric (m, m\u00b2)"],
        ["imperial", "Imperial (ft, sq ft)"],
      ],
      this._config.units,
      (v) => { this._config.units = v; this._emit(true); }
    )));

    const colorRow = document.createElement("div");
    colorRow.className = "row";
    const colorInput = this._input("color", this._toHexColor(this._config.color_on), (v) => {
      this._config.color_on = v;
      this._emit();
    });
    colorRow.appendChild(colorInput);
    colorRow.appendChild(this._input("text", this._config.color_on, (v) => {
      this._config.color_on = v;
      this._emit();
    }, { placeholder: "var(--accent-color)" }));
    grid.appendChild(this._field("Active colour", colorRow));

    section.appendChild(grid);

    const toggles = document.createElement("div");
    toggles.className = "row wrap";
    toggles.style.marginTop = "10px";
    toggles.style.gap = "14px";
    toggles.appendChild(this._checkbox("Show names", this._config.show_names, (v) => { this._config.show_names = v; this._emit(); }));
    toggles.appendChild(this._checkbox("Show states", this._config.show_states, (v) => { this._config.show_states = v; this._emit(); }));
    toggles.appendChild(this._checkbox("Pinch / scroll zoom", this._config.allow_zoom, (v) => { this._config.allow_zoom = v; this._emit(); }));
    toggles.appendChild(this._checkbox("All-storeys button", this._config.stack_view, (v) => { this._config.stack_view = v; this._emit(); }));
    toggles.appendChild(this._checkbox("Remember last storey", this._config.remember_floor, (v) => { this._config.remember_floor = v; this._emit(); }));
    toggles.appendChild(this._checkbox("Show rooms", this._config.show_rooms, (v) => { this._config.show_rooms = v; this._emit(true); }));
    toggles.appendChild(this._checkbox("Room dimensions", this._config.show_room_dimensions, (v) => { this._config.show_room_dimensions = v; this._emit(); }));
    toggles.appendChild(this._checkbox("Room areas", this._config.show_room_areas, (v) => { this._config.show_room_areas = v; this._emit(); }));
    section.appendChild(toggles);

    return section;
  }

  _toHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#fdd835";
  }

  _renderFloorsSection() {
    const addBtn = this._iconBtn("mdi:plus", "Add storey", () => {
      const levels = this._config.floors.map((f) => f.level);
      const level = levels.length ? Math.max(...levels) + 1 : 0;
      this._config.floors.unshift(normalizeFloor({
        id: uid("floor"),
        name: `Floor ${level}`,
        level,
        markers: [],
      }, 0));
      this._floorIndex = 0;
      this._emit(true);
    });
    const section = this._section("Storeys", addBtn);

    this._config.floors.forEach((floor, i) => {
      const row = document.createElement("div");
      row.className = "floor-row";
      row.dataset.selected = String(i === this._floorIndex);
      row.addEventListener("click", () => {
        this._floorIndex = i;
        this._openMarker = null;
        this._render();
      });

      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", floor.icon || "mdi:floor-plan");
      icon.style.setProperty("--mdc-icon-size", "20px");
      row.appendChild(icon);

      const name = document.createElement("div");
      name.className = "nm";
      name.textContent = floor.name;
      row.appendChild(name);

      const lvl = document.createElement("div");
      lvl.className = "lvl";
      lvl.textContent = `L${floor.level} · ${floor.markers.length} marker${floor.markers.length === 1 ? "" : "s"}`;
      row.appendChild(lvl);

      row.appendChild(this._iconBtn("mdi:arrow-up", "Move up", () => this._moveFloor(i, -1), i === 0));
      row.appendChild(this._iconBtn("mdi:arrow-down", "Move down", () => this._moveFloor(i, 1), i === this._config.floors.length - 1));
      row.appendChild(this._iconBtn("mdi:delete-outline", "Delete storey", () => {
        if (this._config.floors.length === 1) return;
        this._config.floors.splice(i, 1);
        this._floorIndex = clamp(this._floorIndex, 0, this._config.floors.length - 1);
        this._emit(true);
      }, this._config.floors.length === 1));

      section.appendChild(row);
    });

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Storeys are ordered highest first, the way they stack in the house. Moving a row swaps its level number.";
    section.appendChild(hint);
    return section;
  }

  _moveFloor(index, delta) {
    const target = index + delta;
    const floors = this._config.floors;
    if (target < 0 || target >= floors.length) return;
    const a = floors[index];
    const b = floors[target];
    const levelA = a.level;
    a.level = b.level;
    b.level = levelA;
    floors[index] = b;
    floors[target] = a;
    if (this._floorIndex === index) this._floorIndex = target;
    else if (this._floorIndex === target) this._floorIndex = index;
    this._emit(true);
  }

  _renderFloorDetail() {
    const floor = this._floor;
    const section = this._section(`Storey — ${floor.name}`);
    const heading = section.querySelector("h4 .grow");

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.appendChild(this._field("Name", this._input("text", floor.name, (v) => {
      floor.name = v || "Floor";
      this._emit();
      // Nothing re-renders on a rename, so move the labels along by hand.
      if (heading) heading.textContent = `Storey — ${floor.name}`;
      const row = this.shadowRoot.querySelectorAll(".floor-row")[this._floorIndex];
      const label = row && row.querySelector(".nm");
      if (label) label.textContent = floor.name;
      const rooms = this.shadowRoot.querySelector(".section.rooms h4 .grow");
      if (rooms) rooms.textContent = `Rooms on ${floor.name}`;
    })));
    grid.appendChild(this._field("Level (0 = ground)", this._input("number", floor.level, (v) => {
      floor.level = Number(v) || 0;
      this._emit();
    }, { step: 1 })));
    grid.appendChild(this._field("Tab icon", this._iconControl(floor.icon, (v) => {
      floor.icon = v || undefined;
      this._emit();
    })));
    grid.appendChild(this._field("Aspect ratio (optional)", this._input("text", floor.aspect_ratio || "", (v) => {
      floor.aspect_ratio = v || undefined;
      this._emit();
    }, { placeholder: "16:9" })));
    section.appendChild(grid);

    const imgField = this._field(
      "Floorplan image or SVG",
      this._input("text", floor.image, (v) => {
        floor.image = v;
        this._emit(true);
      }, { placeholder: "/local/floorplans/ground.svg" })
    );
    imgField.style.marginTop = "10px";
    section.appendChild(imgField);

    const darkField = this._field(
      "Dark-theme variant (optional)",
      this._input("text", floor.image_dark, (v) => {
        floor.image_dark = v;
        this._emit(true);
      }, { placeholder: "/local/floorplans/ground-dark.svg" })
    );
    darkField.style.marginTop = "10px";
    section.appendChild(darkField);

    const svgToggle = this._checkbox(
      "Inline the SVG (needed to colour rooms by entity state)",
      floor.inline_svg,
      (v) => { floor.inline_svg = v; this._emit(true); }
    );
    svgToggle.style.marginTop = "10px";
    section.appendChild(svgToggle);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Put files in config/www/ — they are served from /local/. PNG, JPG, WebP and SVG all work.";
    section.appendChild(hint);

    section.appendChild(this._renderPreview());
    return section;
  }

  _renderPreview() {
    const floor = this._floor;
    const wrap = document.createElement("div");
    wrap.className = `preview-wrap${this._placing ? " placing" : ""}`;

    const src = floor.image_dark && !floor.image ? floor.image_dark : floor.image;
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      img.addEventListener("error", () => {
        img.remove();
        const empty = document.createElement("div");
        empty.className = "preview-empty";
        empty.textContent = `"${src}" could not be loaded. Check the path — files in config/www/ are served from /local/.`;
        wrap.insertBefore(empty, wrap.firstChild);
      });
      wrap.appendChild(img);
    } else {
      const empty = document.createElement("div");
      empty.className = "preview-empty";
      empty.textContent = "No image needed — the rooms below draw the plan.";
      wrap.appendChild(empty);
    }

    const layout = solveFloorLayout(floor);
    if (layout.extent) {
      if (!src) wrap.style.aspectRatio = `${layout.extent.width} / ${layout.extent.depth}`;
      floor.rooms.forEach((room) => {
        wrap.appendChild(this._renderPreviewRoom(room, layout, wrap));
      });
    }

    floor.markers.forEach((marker, i) => {
      wrap.appendChild(this._renderPreviewDot(marker, i, wrap));
    });

    wrap.addEventListener("click", (ev) => {
      if (!this._placing) return;
      const pos = this._relativePos(ev, wrap);
      const marker = normalizeMarker({ entity: "", x: pos.x, y: pos.y }, floor.markers.length);
      floor.markers.push(marker);
      this._openMarker = marker.id;
      this._placing = false;
      this._emit(true);
    });

    const bar = document.createElement("div");
    bar.className = "row wrap";
    bar.style.marginTop = "10px";
    const placeBtn = this._button(
      this._placing ? "mdi:close" : "mdi:map-marker-plus-outline",
      this._placing ? "Cancel placing" : "Click plan to add marker",
      () => { this._placing = !this._placing; this._render(); },
      this._placing ? "" : "primary"
    );
    bar.appendChild(placeBtn);
    bar.appendChild(this._button("mdi:plus", "Add at centre", () => {
      const marker = normalizeMarker({ entity: "", x: 50, y: 50 }, floor.markers.length);
      floor.markers.push(marker);
      this._openMarker = marker.id;
      this._emit(true);
    }));

    const holder = document.createElement("div");
    holder.appendChild(wrap);
    holder.appendChild(bar);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Drag any marker on the plan to reposition it. Positions are stored as a percentage, so the layout survives a change of image size.";
    holder.appendChild(hint);
    return holder;
  }

  _relativePos(ev, wrap) {
    const rect = wrap.getBoundingClientRect();
    return {
      x: round2(clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100)),
      y: round2(clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100)),
    };
  }

  _renderPreviewDot(marker, index, wrap) {
    const dot = document.createElement("div");
    dot.className = "dot";
    dot.dataset.marker = marker.id;
    dot.dataset.selected = String(this._openMarker === marker.id);
    dot.style.left = `${marker.x}%`;
    dot.style.top = `${marker.y}%`;
    dot.title = marker.entity || "no entity yet";

    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", marker.icon || fallbackIcon(marker.entity, this._hass && this._hass.states[marker.entity]));
    dot.appendChild(icon);

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(index + 1);
    dot.appendChild(num);

    let dragging = false;
    let moved = false;

    dot.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      dragging = true;
      moved = false;
      try { dot.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic pointer */ }
      dot.classList.add("dragging");
    });
    dot.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      moved = true;
      const pos = this._relativePos(ev, wrap);
      marker.x = pos.x;
      marker.y = pos.y;
      dot.style.left = `${pos.x}%`;
      dot.style.top = `${pos.y}%`;
      const posLabel = this.shadowRoot.querySelector(`.marker-card[data-marker="${marker.id}"] .pos`);
      if (posLabel) posLabel.textContent = `${pos.x} / ${pos.y}`;
    });
    const stop = (ev) => {
      if (!dragging) return;
      dragging = false;
      dot.classList.remove("dragging");
      try { dot.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      if (moved) this._emit();
      else {
        this._openMarker = this._openMarker === marker.id ? null : marker.id;
        this._render();
      }
    };
    dot.addEventListener("pointerup", stop);
    dot.addEventListener("pointercancel", stop);
    dot.addEventListener("click", (ev) => ev.stopPropagation());

    return dot;
  }

  /* ---------------- rooms ---------------- */

  _system() {
    return unitSystemOf(this._config, this._hass);
  }

  _areaOptions() {
    const areas = (this._hass && this._hass.areas) || {};
    return Object.keys(areas)
      .map((id) => [id, areas[id].name || id])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }

  /** Entities belonging to an area, directly or through their device. */
  _entitiesInArea(areaId) {
    if (!this._hass || !areaId) return [];
    const entities = this._hass.entities || {};
    const devices = this._hass.devices || {};
    return Object.keys(entities).filter((id) => {
      const entry = entities[id];
      if (!entry || entry.hidden_by || entry.disabled_by) return false;
      if (entry.area_id) return entry.area_id === areaId;
      const device = entry.device_id ? devices[entry.device_id] : null;
      return Boolean(device && device.area_id === areaId);
    }).sort();
  }

  _renderPreviewRoom(room, layout, wrap) {
    const extent = layout.extent;
    const box = layout.boxes.get(room.id);
    if (!box) return document.createElement("div");
    const system = this._system();

    const el = document.createElement("div");
    el.className = "room-box";
    el.dataset.room = room.id;
    el.dataset.selected = String(this._openRoom === room.id);
    el.style.left = `${(box.x / extent.width) * 100}%`;
    el.style.top = `${(box.y / extent.depth) * 100}%`;
    el.style.width = `${(box.width / extent.width) * 100}%`;
    el.style.height = `${(box.depth / extent.depth) * 100}%`;
    if (room.color) el.style.setProperty("--room-tint", room.color);
    if (room.fill !== null) el.style.setProperty("--room-fill", `${room.fill}%`);

    const label = document.createElement("span");
    label.className = "room-box-label";
    label.textContent = `${room.name || "Room"}\n${formatLength(room.width, system)} \u00d7 ${formatLength(room.depth, system)}`;
    el.appendChild(label);

    const handle = document.createElement("div");
    handle.className = "room-resize";
    el.appendChild(handle);

    room.devices.forEach((device, i) => {
      el.appendChild(this._renderPreviewDevice(room, device, i, el));
    });

    const metresAt = (ev) => {
      const rect = wrap.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / rect.width) * extent.width,
        y: ((ev.clientY - rect.top) / rect.height) * extent.depth,
      };
    };

    let mode = null;
    let origin = null;

    /**
     * Re-solve and move the existing boxes, without rebuilding the editor.
     * Re-rendering mid-drag would destroy the node holding pointer capture and
     * the drag would die after one move event, so everything here is in place.
     * The extent stays frozen at its drag-start value so the pixels-to-metres
     * mapping cannot shift under the pointer; the release re-renders properly.
     */
    const repaint = () => {
      const solved = solveFloorLayout(this._floor);
      this._floor.rooms.forEach((other) => {
        const otherBox = solved.boxes.get(other.id);
        const node = wrap.querySelector(`.room-box[data-room="${other.id}"]`);
        if (!otherBox || !node) return;
        node.style.left = `${(otherBox.x / extent.width) * 100}%`;
        node.style.top = `${(otherBox.y / extent.depth) * 100}%`;
        node.style.width = `${(otherBox.width / extent.width) * 100}%`;
        node.style.height = `${(otherBox.depth / extent.depth) * 100}%`;
        const caption = node.querySelector(".room-box-label");
        if (caption) {
          caption.textContent = `${other.name || "Room"}\n${formatLength(other.width, system)} \u00d7 ${formatLength(other.depth, system)}`;
        }
      });
    };

    const start = (kind, target) => (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      mode = kind;
      origin = { at: metresAt(ev), x: box.x, y: box.y, width: room.width, depth: room.depth, moved: false };
      try { target.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic pointer */ }
      el.classList.add("dragging");
    };

    const move = (ev) => {
      if (!mode) return;
      const at = metresAt(ev);
      const dx = at.x - origin.at.x;
      const dy = at.y - origin.at.y;
      // Ignore the jitter of a click, so tapping a room still selects it.
      if (!origin.moved && Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) return;
      origin.moved = true;

      if (mode === "resize") {
        room.width = Math.max(round2(origin.width + dx), 0.5);
        room.depth = Math.max(round2(origin.depth + dy), 0.5);
        room.floor_area = room.width * room.depth;
      } else {
        const parentBox = room.attach ? layout.boxes.get(room.attach.to) : null;
        if (parentBox) {
          // Keep the room attached: slide it along whichever wall now fits best.
          const best = bestAttachment(parentBox, room, { x: origin.x + dx, y: origin.y + dy });
          room.attach.wall = best.wall;
          room.attach.offset = best.offset;
        } else {
          room.x = round2(Math.max(origin.x + dx, 0));
          room.y = round2(Math.max(origin.y + dy, 0));
        }
      }
      repaint();
    };

    const stop = (ev) => {
      if (!mode) return;
      const target = mode === "resize" ? handle : el;
      const moved = origin.moved;
      mode = null;
      el.classList.remove("dragging");
      try { target.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      if (moved) this._emit(true); // commit once, and re-solve the extent
      else {
        this._openRoom = this._openRoom === room.id ? null : room.id;
        this._render();
      }
    };

    el.addEventListener("pointerdown", start("move", el));
    handle.addEventListener("pointerdown", start("resize", handle));
    [el, handle].forEach((node) => {
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", stop);
      node.addEventListener("pointercancel", stop);
    });
    el.addEventListener("click", (ev) => ev.stopPropagation());
    return el;
  }

  _renderPreviewDevice(room, device, index, roomEl) {
    const dot = document.createElement("div");
    dot.className = "device-dot";
    dot.title = device.entity || "no entity yet";

    const auto = room.devices.filter((d) => d.x === null || d.y === null);
    const cols = Math.max(1, Math.ceil(Math.sqrt(auto.length)));
    const rows = Math.max(1, Math.ceil(auto.length / cols));
    const slot = auto.indexOf(device);
    const rx = device.x === null ? (((slot % cols) + 0.5) / cols) * 100 : device.x;
    const ry = device.y === null ? ((Math.floor(slot / cols) + 0.5) / rows) * 100 : device.y;
    dot.style.left = `${rx}%`;
    dot.style.top = `${ry}%`;

    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", device.icon || fallbackIcon(device.entity, this._hass && this._hass.states[device.entity]));
    dot.appendChild(icon);

    let dragging = false;
    let moved = false;
    dot.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      dragging = true;
      moved = false;
      try { dot.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic pointer */ }
    });
    dot.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      moved = true;
      const rect = roomEl.getBoundingClientRect();
      device.x = round2(clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100));
      device.y = round2(clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100));
      dot.style.left = `${device.x}%`;
      dot.style.top = `${device.y}%`;
    });
    const stop = (ev) => {
      if (!dragging) return;
      dragging = false;
      try { dot.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      if (moved) this._emit();
    };
    dot.addEventListener("pointerup", stop);
    dot.addEventListener("pointercancel", stop);
    dot.addEventListener("click", (ev) => ev.stopPropagation());
    return dot;
  }

  _lengthInput(metres, system, onChange, opts = {}) {
    return this._input("text", lengthFieldValue(metres, system), (v) => {
      const parsed = parseLength(v, system === "imperial" ? "ft" : "m");
      onChange(parsed === null ? 0 : Math.max(round2(parsed), 0));
    }, {
      placeholder: system === "imperial" ? "12, or 12ft6in" : "3.6",
      lazy: opts.lazy,
    });
  }

  /** Seed rooms from the areas the user already keeps in Home Assistant. */
  _importAreas(floor) {
    const taken = new Set(floor.rooms.map((room) => room.area).filter(Boolean));
    const fresh = this._areaOptions().filter(([id]) => !taken.has(id));
    if (!fresh.length) return 0;

    let previous = floor.rooms.length ? floor.rooms[floor.rooms.length - 1] : null;
    fresh.forEach(([id, name]) => {
      const room = normalizeRoom({
        name,
        area: id,
        size: [4, 4],
        attach: previous ? { to: previous.id, wall: "east", door: true } : undefined,
        devices: this._entitiesInArea(id).slice(0, 6),
      }, floor.rooms.length);
      floor.rooms.push(room);
      previous = room;
    });
    return fresh.length;
  }

  _renderRoomsSection() {
    const floor = this._floor;
    const system = this._system();
    const unit = lengthFieldUnit(system);

    const addBtn = this._iconBtn("mdi:shape-rectangle-plus", "Add room", () => {
      const previous = floor.rooms[floor.rooms.length - 1];
      const room = normalizeRoom({
        name: `Room ${floor.rooms.length + 1}`,
        size: [4, 4],
        attach: previous ? { to: previous.id, wall: "east", door: true } : undefined,
      }, floor.rooms.length);
      floor.rooms.push(room);
      this._openRoom = room.id;
      this._scrollToRoom = room.id;
      this._emit(true);
    });
    const section = this._section(`Rooms on ${floor.name}`, addBtn);
    section.classList.add("rooms");

    if (this._areaOptions().length) {
      const bar = document.createElement("div");
      bar.className = "row wrap";
      bar.appendChild(this._button("mdi:import", "Add rooms from my HA areas", () => {
        const added = this._importAreas(floor);
        if (added) this._emit(true);
      }));
      section.appendChild(bar);
    }

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = `Give each room its real size, then say which room it joins and where the door goes \u2014 the plan is worked out from that. Drag a room on the preview to slide it round its neighbour, or drag its corner to resize. Sizes are in ${unit === "ft" ? "feet" : "metres"}.`;
    section.appendChild(hint);

    if (!floor.rooms.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = "No rooms yet. Add one with +, or import the areas you already have in Home Assistant.";
      section.appendChild(empty);
      return section;
    }

    const layout = solveFloorLayout(floor);
    layout.problems.forEach((problem) => {
      const warn = document.createElement("div");
      warn.className = "empty-hint";
      warn.textContent = `\u26a0 ${problem}`;
      section.appendChild(warn);
    });

    floor.rooms.forEach((room, index) => {
      section.appendChild(this._renderRoomCard(room, index, floor, system, unit));
    });
    return section;
  }

  _renderRoomCard(room, index, floor, system, unit) {
    const card = document.createElement("div");
    card.className = "marker-card room-card";
    card.dataset.room = room.id;
    card.dataset.open = String(this._openRoom === room.id);

    const head = document.createElement("div");
    head.className = "marker-head";
    head.addEventListener("click", () => {
      this._openRoom = this._openRoom === room.id ? null : room.id;
      this._render();
    });

    const chip = document.createElement("span");
    chip.className = "tint-chip";
    chip.dataset.chip = "tint";
    chip.style.background = room.color || "var(--accent-color, #03a9f4)";
    chip.style.opacity = room.color ? "1" : ".35";
    head.appendChild(chip);

    const title = document.createElement("span");
    title.className = "grow";
    title.textContent = room.name || `Room ${index + 1}`;
    head.appendChild(title);

    const readout = document.createElement("span");
    readout.className = "pos";
    readout.textContent = `${formatLength(room.width, system)} \u00d7 ${formatLength(room.depth, system)} \u00b7 ${formatArea(room.width * room.depth, system)}`;
    head.appendChild(readout);

    head.appendChild(this._iconBtn("mdi:delete-outline", "Remove room", () => {
      // Anything hanging off this room would dangle, so re-home it first.
      floor.rooms.forEach((other) => {
        if (other.attach && other.attach.to === room.id) other.attach = room.attach ? { ...room.attach } : null;
      });
      floor.rooms.splice(index, 1);
      if (this._openRoom === room.id) this._openRoom = null;
      this._emit(true);
    }));
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "marker-body";

    const top = document.createElement("div");
    top.className = "grid";
    top.appendChild(this._field("Name", this._input("text", room.name, (v) => {
      room.name = v;
      title.textContent = v || `Room ${index + 1}`;
      this._emit();
    }, { placeholder: "Living Room" })));

    const areas = this._areaOptions();
    if (areas.length) {
      top.appendChild(this._field("Home Assistant area", this._select(
        [["", "Not linked"]].concat(areas),
        room.area || "",
        (v) => {
          room.area = v;
          if (v && !room.name) room.name = (this._hass.areas[v] || {}).name || "";
          this._emit(true);
        }
      )));
    }
    body.appendChild(top);

    const size = document.createElement("div");
    size.className = "grid";
    [["Width", "width"], ["Depth", "depth"]].forEach(([text, key]) => {
      size.appendChild(this._field(`${text} (${unit})`, this._lengthInput(room[key], system, (metres) => {
        room[key] = metres;
        room.floor_area = room.width * room.depth;
        this._emit(true);
      }, { lazy: true })));
    });
    body.appendChild(size);

    body.appendChild(this._renderAttachControls(room, floor, system, unit));

    body.appendChild(this._renderRoomColor(room));

    body.appendChild(this._checkbox("Show label on the plan", room.label, (v) => {
      room.label = v;
      this._emit(true);
    }));

    body.appendChild(this._renderDeviceControls(room));

    card.appendChild(body);
    return card;
  }

  /**
   * The room's own color: a palette for the quick choice, a picker and a free
   * text field for anything else (a hex value, `rgb()`, or a theme variable),
   * and how strongly that colour fills the room on the plan.
   */
  _renderRoomColor(room) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "10px";

    const heading = document.createElement("span");
    heading.style.fontSize = "13px";
    heading.textContent = "Colour on the plan";
    wrap.appendChild(heading);

    const swatches = document.createElement("div");
    swatches.className = "swatches";

    const swatch = (value, name, pressed) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = value ? "swatch" : "swatch none";
      btn.title = name;
      btn.setAttribute("aria-label", name);
      btn.setAttribute("aria-pressed", String(pressed));
      if (value) {
        btn.style.background = value;
      } else {
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:palette-outline");
        btn.appendChild(icon);
      }
      btn.addEventListener("click", () => {
        room.color = value;
        this._emit(true);
      });
      return btn;
    };

    const current = String(room.color || "").trim().toLowerCase();
    swatches.appendChild(swatch("", "Theme default", !current));
    ROOM_COLORS.forEach(([value, name]) => {
      swatches.appendChild(swatch(value, name, current === value));
    });
    wrap.appendChild(swatches);

    const customRow = document.createElement("div");
    customRow.className = "row";
    customRow.appendChild(this._input("color", this._toHexColor(room.color), (v) => {
      room.color = v;
      this._emit(true);
    }));
    const text = this._input("text", room.color, (v) => {
      room.color = v.trim();
      this._repaintRoomTint(room);
      this._emit();
    }, { placeholder: "Theme default \u2014 or #4caf50, var(--accent-color)" });
    text.className = "grow";
    customRow.appendChild(text);
    wrap.appendChild(this._field("Custom colour", customRow));

    const fillRow = document.createElement("div");
    fillRow.className = "fill-row";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.step = "1";
    range.value = String(room.fill === null ? ROOM_FILL_DEFAULT : room.fill);
    const readout = document.createElement("span");
    readout.className = "val";
    readout.textContent = `${range.value}%`;
    // Dragging repaints in place: a re-render would destroy the slider holding
    // the pointer, so the config only goes out once the value settles.
    range.addEventListener("input", () => {
      room.fill = Number(range.value);
      readout.textContent = `${room.fill}%`;
      this._repaintRoomTint(room);
    });
    range.addEventListener("change", () => {
      room.fill = Number(range.value);
      this._emit();
    });
    fillRow.appendChild(range);
    fillRow.appendChild(readout);
    fillRow.appendChild(this._iconBtn("mdi:restore", "Back to the default fill", () => {
      room.fill = null;
      this._emit(true);
    }, room.fill === null));
    wrap.appendChild(this._field("Fill strength", fillRow));

    return wrap;
  }

  /** Push a room's tint into the preview and its card header, without a re-render. */
  _repaintRoomTint(room) {
    if (!this.shadowRoot) return;
    const box = this.shadowRoot.querySelector(`.room-box[data-room="${room.id}"]`);
    if (box) {
      if (room.color) box.style.setProperty("--room-tint", room.color);
      else box.style.removeProperty("--room-tint");
      if (room.fill === null) box.style.removeProperty("--room-fill");
      else box.style.setProperty("--room-fill", `${room.fill}%`);
    }
    const chip = this.shadowRoot.querySelector(`.room-card[data-room="${room.id}"] [data-chip="tint"]`);
    if (chip) {
      chip.style.background = room.color || "var(--accent-color, #03a9f4)";
      chip.style.opacity = room.color ? "1" : ".35";
    }
  }

  _renderAttachControls(room, floor, system, unit) {
    const wrap = document.createElement("div");
    const others = floor.rooms.filter((other) => other.id !== room.id);

    const joinRow = document.createElement("div");
    joinRow.className = "grid";
    joinRow.appendChild(this._field("Joins", this._select(
      [["", "Nothing \u2014 anchors the plan"]].concat(others.map((other) => [other.id, other.name])),
      room.attach ? room.attach.to : "",
      (v) => {
        room.attach = v ? normalizeAttach({ to: v, wall: "east", door: true }) : null;
        this._emit(true);
      }
    )));

    if (!room.attach) {
      wrap.appendChild(joinRow);
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = "This room anchors the storey; everything else is positioned relative to it.";
      wrap.appendChild(note);
      return wrap;
    }

    joinRow.appendChild(this._field("On its", this._select(
      [["north", "North wall (above)"], ["east", "East wall (right)"],
       ["south", "South wall (below)"], ["west", "West wall (left)"]],
      room.attach.wall,
      (v) => { room.attach.wall = v; this._emit(true); }
    )));
    wrap.appendChild(joinRow);

    const offsetRow = document.createElement("div");
    offsetRow.className = "grid";
    offsetRow.appendChild(this._field(`Offset along that wall (${unit})`, this._lengthInput(
      room.attach.offset, system, (metres) => { room.attach.offset = metres; this._emit(true); }, { lazy: true }
    )));
    wrap.appendChild(offsetRow);

    wrap.appendChild(this._checkbox("Door between them", Boolean(room.attach.door), (v) => {
      room.attach.door = v ? { at: null, width: DEFAULT_DOOR_WIDTH } : null;
      this._emit(true);
    }));

    if (room.attach.door) {
      const doorRow = document.createElement("div");
      doorRow.className = "grid";
      doorRow.appendChild(this._field(`Door at (${unit}, blank = centred)`, this._lengthInput(
        room.attach.door.at, system,
        (metres) => { room.attach.door.at = metres; this._emit(true); },
        { lazy: true }
      )));
      doorRow.appendChild(this._field(`Door width (${unit})`, this._lengthInput(
        room.attach.door.width, system,
        (metres) => { room.attach.door.width = metres || DEFAULT_DOOR_WIDTH; this._emit(true); },
        { lazy: true }
      )));
      wrap.appendChild(doorRow);
    }
    return wrap;
  }

  _renderDeviceControls(room) {
    const wrap = document.createElement("div");
    const header = document.createElement("div");
    header.className = "row";
    header.style.marginTop = "10px";
    const label = document.createElement("span");
    label.className = "grow";
    label.style.fontSize = "13px";
    label.textContent = `Devices in ${room.name || "this room"}`;
    header.appendChild(label);
    header.appendChild(this._iconBtn("mdi:plus", "Add device", () => {
      room.devices.push(normalizeDevice({ entity: "" }, room.devices.length));
      this._emit(true);
    }));
    wrap.appendChild(header);

    const suggestions = room.area ? this._entitiesInArea(room.area) : [];
    const present = new Set(room.devices.map((device) => device.entity));
    const missing = suggestions.filter((id) => !present.has(id));
    if (missing.length) {
      const bar = document.createElement("div");
      bar.className = "row wrap";
      bar.appendChild(this._button("mdi:import", `Add all ${missing.length} from this area`, () => {
        missing.forEach((id) => room.devices.push(normalizeDevice({ entity: id }, room.devices.length)));
        this._emit(true);
      }));
      wrap.appendChild(bar);
    }

    room.devices.forEach((device, i) => {
      const row = document.createElement("div");
      row.className = "row";
      const picker = this._entityControl(device.entity, (v) => {
        device.entity = v;
        this._emit(true);
      });
      picker.style.flex = "1";
      row.appendChild(picker);
      row.appendChild(this._iconBtn("mdi:crosshairs-gps", device.x === null ? "Positioned automatically" : "Reset to automatic position", () => {
        device.x = null;
        device.y = null;
        this._emit(true);
      }, device.x === null));
      row.appendChild(this._iconBtn("mdi:delete-outline", "Remove device", () => {
        room.devices.splice(i, 1);
        this._emit(true);
      }));
      wrap.appendChild(row);
    });

    if (!room.devices.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = room.area
        ? "No devices placed yet."
        : "No devices yet. Link this room to a Home Assistant area to pick from its entities.";
      wrap.appendChild(empty);
    }
    return wrap;
  }

  _renderMarkersSection() {
    const floor = this._floor;
    const section = this._section(`Markers on ${floor.name}`);

    if (!floor.markers.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = "No markers yet. Use “Click plan to add marker” above, then pick an entity.";
      section.appendChild(empty);
      return section;
    }

    floor.markers.forEach((marker, i) => {
      section.appendChild(this._renderMarkerCard(marker, i, floor));
    });
    return section;
  }

  _renderMarkerCard(marker, index, floor) {
    const open = this._openMarker === marker.id;
    const card = document.createElement("div");
    card.className = "marker-card";
    card.dataset.marker = marker.id;
    card.dataset.open = String(open);
    card.dataset.selected = String(open);

    const head = document.createElement("div");
    head.className = "marker-head";
    head.addEventListener("click", () => {
      this._openMarker = open ? null : marker.id;
      this._render();
    });

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(index + 1);
    head.appendChild(idx);

    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", marker.icon || fallbackIcon(marker.entity, this._hass && this._hass.states[marker.entity]));
    icon.style.setProperty("--mdc-icon-size", "20px");
    head.appendChild(icon);

    const title = document.createElement("span");
    title.className = "ttl";
    title.textContent = marker.name || marker.entity || "— pick an entity —";
    head.appendChild(title);

    const pos = document.createElement("span");
    pos.className = "pos";
    pos.textContent = `${marker.x} / ${marker.y}`;
    head.appendChild(pos);

    head.appendChild(this._iconBtn("mdi:content-copy", "Duplicate", () => {
      const copy = normalizeMarker({ ...marker, id: undefined, x: clamp(marker.x + 4, 0, 100), y: clamp(marker.y + 4, 0, 100) }, index);
      floor.markers.splice(index + 1, 0, copy);
      this._openMarker = copy.id;
      this._emit(true);
    }));
    head.appendChild(this._iconBtn("mdi:delete-outline", "Delete marker", () => {
      floor.markers.splice(index, 1);
      if (this._openMarker === marker.id) this._openMarker = null;
      this._emit(true);
    }));

    card.appendChild(head);
    if (!open) return card;

    const body = document.createElement("div");
    body.className = "marker-body";

    body.appendChild(this._field("Entity", this._entityControl(marker.entity, (v) => {
      marker.entity = v;
      this._emit(true);
    })));

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.style.marginTop = "10px";

    grid.appendChild(this._field("Name override", this._input("text", marker.name || "", (v) => {
      marker.name = v || undefined;
      this._emit();
      title.textContent = marker.name || marker.entity || "— pick an entity —";
    }, { placeholder: "from the entity" })));

    grid.appendChild(this._field("Icon override", this._iconControl(marker.icon, (v) => {
      marker.icon = v || undefined;
      this._emit();
    })));

    grid.appendChild(this._field("Style", this._select(MARKER_STYLES, marker.style, (v) => {
      marker.style = v;
      this._emit(true);
    })));

    grid.appendChild(this._field("Size (px, optional)", this._input("number", marker.size || "", (v) => {
      marker.size = v === "" ? undefined : Number(v);
      this._emit();
    }, { min: 12, max: 96, step: 1, placeholder: String(this._config.marker_size) })));

    grid.appendChild(this._field("X (%)", this._input("number", marker.x, (v) => {
      marker.x = clamp(Number(v) || 0, -20, 120);
      this._emit();
      const dot = this.shadowRoot.querySelector(`.dot[data-marker="${marker.id}"]`);
      if (dot) dot.style.left = `${marker.x}%`;
      pos.textContent = `${marker.x} / ${marker.y}`;
    }, { step: 0.5 })));

    grid.appendChild(this._field("Y (%)", this._input("number", marker.y, (v) => {
      marker.y = clamp(Number(v) || 0, -20, 120);
      this._emit();
      const dot = this.shadowRoot.querySelector(`.dot[data-marker="${marker.id}"]`);
      if (dot) dot.style.top = `${marker.y}%`;
      pos.textContent = `${marker.x} / ${marker.y}`;
    }, { step: 0.5 })));

    if (marker.style === "area") {
      grid.appendChild(this._field("Width (%)", this._input("number", marker.width === undefined ? 20 : marker.width, (v) => {
        marker.width = Number(v) || 0;
        this._emit();
      }, { min: 1, max: 100, step: 1 })));
      grid.appendChild(this._field("Height (%)", this._input("number", marker.height === undefined ? 20 : marker.height, (v) => {
        marker.height = Number(v) || 0;
        this._emit();
      }, { min: 1, max: 100, step: 1 })));
    }

    const colorRow = document.createElement("div");
    colorRow.className = "row";
    colorRow.appendChild(this._input("color", this._toHexColor(marker.color_on || this._config.color_on), (v) => {
      marker.color_on = v;
      this._emit();
    }));
    colorRow.appendChild(this._input("text", marker.color_on || "", (v) => {
      marker.color_on = v || undefined;
      this._emit();
    }, { placeholder: "inherit from card" }));
    grid.appendChild(this._field("Active colour", colorRow));

    grid.appendChild(this._field("Tap action", this._select(TAP_ACTIONS, (marker.tap_action && marker.tap_action.action) || "more-info", (v) => {
      marker.tap_action = { ...(marker.tap_action || {}), action: v };
      this._emit(true);
    })));

    grid.appendChild(this._field("Hold action", this._select(TAP_ACTIONS, (marker.hold_action && marker.hold_action.action) || "none", (v) => {
      marker.hold_action = { ...(marker.hold_action || {}), action: v };
      this._emit(true);
    })));

    body.appendChild(grid);

    const tapAction = marker.tap_action && marker.tap_action.action;
    if (tapAction === "navigate") {
      const f = this._field("Navigate to", this._input("text", marker.tap_action.navigation_path || "", (v) => {
        marker.tap_action = { ...marker.tap_action, navigation_path: v };
        this._emit();
      }, { placeholder: "/lovelace/kitchen" }));
      f.style.marginTop = "10px";
      body.appendChild(f);
    } else if (tapAction === "call-service") {
      const f = this._field("Service", this._input("text", marker.tap_action.service || "", (v) => {
        marker.tap_action = { ...marker.tap_action, service: v };
        this._emit();
      }, { placeholder: "script.goodnight" }));
      f.style.marginTop = "10px";
      body.appendChild(f);
    }

    const toggles = document.createElement("div");
    toggles.className = "row wrap";
    toggles.style.marginTop = "10px";
    toggles.style.gap = "14px";
    toggles.appendChild(this._checkbox("Show name", marker.show_name === undefined ? this._config.show_names : marker.show_name, (v) => {
      marker.show_name = v;
      this._emit();
    }));
    toggles.appendChild(this._checkbox("Show state", marker.show_state === undefined ? this._config.show_states : marker.show_state, (v) => {
      marker.show_state = v;
      this._emit();
    }));
    toggles.appendChild(this._checkbox("Hide when off", marker.hide_when_off, (v) => {
      marker.hide_when_off = v;
      this._emit();
    }));
    body.appendChild(toggles);

    card.appendChild(body);
    return card;
  }

  _renderBindingsSection() {
    const floor = this._floor;
    const addBtn = this._iconBtn("mdi:plus", "Add room binding", () => {
      floor.svg_bindings.push(normalizeBinding({ selector: "", entity: "" }));
      this._emit(true);
    });
    const section = this._section("Room highlights (inline SVG)", addBtn);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.style.margin = "0 2px 10px";
    hint.textContent = "Give an element in your SVG an id (e.g. id=\"kitchen\" on the room's <path>), then bind it to an entity here. The shape is tinted whenever that entity is on.";
    section.appendChild(hint);

    if (!floor.svg_bindings.length) {
      const empty = document.createElement("div");
      empty.className = "empty-hint";
      empty.textContent = "No room highlights yet.";
      section.appendChild(empty);
      return section;
    }

    floor.svg_bindings.forEach((binding, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.marginBottom = "8px";

      const sel = this._input("text", binding.selector, (v) => {
        binding.selector = v;
        this._emit();
      }, { placeholder: "#kitchen" });
      sel.style.maxWidth = "160px";
      row.appendChild(sel);

      const entityWrap = document.createElement("div");
      entityWrap.className = "grow";
      entityWrap.appendChild(this._entityControl(binding.entity, (v) => {
        binding.entity = v;
        this._emit();
      }));
      row.appendChild(entityWrap);

      row.appendChild(this._input("color", this._toHexColor(binding.color_on || this._config.color_on), (v) => {
        binding.color_on = v;
        this._emit();
      }));

      row.appendChild(this._iconBtn("mdi:delete-outline", "Remove binding", () => {
        floor.svg_bindings.splice(i, 1);
        this._emit(true);
      }));

      section.appendChild(row);
    });

    return section;
  }
}

customElements.define("home-layout-card-editor", HomeLayoutCardEditor);

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

window.customCards = window.customCards || [];
window.customCards.push({
  type: "home-layout-card",
  name: "Home Layout Card",
  description: "A multi-storey floorplan with live entity markers on top of each storey.",
  preview: true,
  documentationURL: "https://github.com/YOUR_USERNAME/home-layout-card",
});

// eslint-disable-next-line no-console
console.info(
  `%c HOME-LAYOUT-CARD %c v${HLC_VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700;border-radius:3px 0 0 3px;padding:2px 4px",
  "color:#03a9f4;background:#2d2d2d;font-weight:700;border-radius:0 3px 3px 0;padding:2px 4px"
);
