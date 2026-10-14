import type { OperationIds } from "./ports";

/** An explicit retry keeps its ID only while its command body stays identical. */
export function createOperationId(ids: OperationIds) {
  let previous: { body: string; id: string } | undefined;
  return (body: unknown): string => {
    const serialized = JSON.stringify(body);
    if (serialized === undefined)
      throw new TypeError("A command body is required");
    if (previous?.body !== serialized)
      previous = { body: serialized, id: ids.next() };
    return previous.id;
  };
}
