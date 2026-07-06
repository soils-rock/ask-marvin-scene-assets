/**
 * Parse latitude/longitude for scene background metadata.
 * Accepts decimal degrees (-23.747658) or DMS (23°44'51.57"S).
 * Stored values are normalized to decimal degrees.
 */

function decimalDegreesString(n) {
  if (!Number.isFinite(n)) return "";
  return n
    .toFixed(8)
    .replace(/\.?0+$/, "")
    .replace(/^-0$/, "0");
}

function axisForDirection(dir) {
  const d = dir.toUpperCase();
  if (d === "N" || d === "S") return "lat";
  if (d === "E" || d === "W") return "long";
  return null;
}

function signFromDirection(dir) {
  const d = dir.toUpperCase();
  if (d === "S" || d === "W") return -1;
  return 1;
}

function normalizeCoordinateText(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"');
}

function validateRange(n, axis) {
  if (axis === "lat" && (n < -90 || n > 90)) {
    return { ok: false, error: "lat must be between -90 and 90." };
  }
  if (axis === "long" && (n < -180 || n > 180)) {
    return { ok: false, error: "long must be between -180 and 180." };
  }
  return { ok: true };
}

/**
 * @param {string} value
 * @param {"lat"|"long"} axis
 */
export function parseCoordinate(value, axis) {
  const s = normalizeCoordinateText(value);
  if (!s) {
    return { ok: false, error: `${axis} is required.` };
  }

  // Plain decimal: -23.747658 or 34.27017
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${axis} must be a finite decimal number.` };
    }
    const range = validateRange(n, axis);
    if (!range.ok) return range;
    return { ok: true, value: decimalDegreesString(n) };
  }

  // DMS: 23°44'51.57"S, 34° 16' 12.6" N, 113°5'32.2"W
  const dmsMatch = s.match(
    /^([+-]?\d+(?:\.\d+)?)\s*(?:°|º|d)?\s*(\d+(?:\.\d+)?)?\s*(?:['′\u2018\u2019]|m)?\s*(\d+(?:\.\d+)?)?\s*(?:["″\u201c\u201d]|s)?\s*([NnSsEeWw])?\s*$/i
  );
  if (!dmsMatch) {
    return {
      ok: false,
      error: `${axis} must be decimal degrees (e.g. -23.747658) or DMS (e.g. 23°44'51.57"S).`,
    };
  }

  const leadingSign = dmsMatch[1].startsWith("-") ? -1 : 1;
  const degrees = Math.abs(Number(dmsMatch[1]));
  const minutes = dmsMatch[2] ? Number(dmsMatch[2]) : 0;
  const seconds = dmsMatch[3] ? Number(dmsMatch[3]) : 0;
  const direction = dmsMatch[4] || "";

  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return { ok: false, error: `${axis} must be a valid coordinate.` };
  }
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    return {
      ok: false,
      error: `${axis} minutes and seconds must be between 0 and 59.99.`,
    };
  }

  let sign = leadingSign;
  if (direction) {
    const dirAxis = axisForDirection(direction);
    if (!dirAxis) {
      return { ok: false, error: `${axis} direction must be N, S, E, or W.` };
    }
    if (dirAxis !== axis) {
      return {
        ok: false,
        error:
          axis === "lat"
            ? "Latitude direction must be N or S."
            : "Longitude direction must be E or W.",
      };
    }
    sign = signFromDirection(direction);
  }

  const decimal = sign * (degrees + minutes / 60 + seconds / 3600);
  const range = validateRange(decimal, axis);
  if (!range.ok) return range;

  return { ok: true, value: decimalDegreesString(decimal) };
}

export function coordinatesAreValid(lat, long) {
  return parseCoordinate(lat, "lat").ok && parseCoordinate(long, "long").ok;
}

export function validateCoordinateFields(lat, long) {
  const latResult = parseCoordinate(lat, "lat");
  if (!latResult.ok) return { ok: false, error: latResult.error };
  const longResult = parseCoordinate(long, "long");
  if (!longResult.ok) return { ok: false, error: longResult.error };
  return { ok: true, lat: latResult.value, long: longResult.value };
}
