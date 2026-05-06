/**
 * Recursive serializer that converts Mongoose-style documents into plain
 * objects with a string `id` field instead of `_id`. Strips `__v`. Handles
 * populated nested docs and arrays.
 *
 * Use this before returning Mongo data via NextResponse so the JSON shape
 * matches what the frontend expects (`{ id, ... }` not `{ _id, ... }`).
 */

type Plain = Record<string, unknown>;

export function toApi<T>(input: T): T extends unknown[] ? unknown[] : T {
  return walk(input) as never;
}

function walk(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(walk);

  // Mongoose Decimal128 has a toString
  const ctorName = (value as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === "Decimal128") return Number((value as { toString(): string }).toString());
  if (ctorName === "ObjectId") return (value as { toString(): string }).toString();

  const out: Plain = {};
  for (const [k, v] of Object.entries(value as Plain)) {
    if (k === "__v") continue;
    if (k === "_id") {
      out.id = typeof v === "object" && v !== null ? walk(v) : v;
    } else {
      out[k] = walk(v);
    }
  }
  return out;
}
