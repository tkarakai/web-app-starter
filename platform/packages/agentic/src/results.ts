export function boundedResult(value: unknown, offset = 0) {
  const json = JSON.stringify(value ?? null);
  if (offset > json.length) throw new Error("INVALID_RESULT_OFFSET");
  if (json.length <= 12_000 && offset === 0) return { result: value ?? null };
  return { format: "json-chunk", chunk: json.slice(offset, offset + 12_000), totalCharacters: json.length, nextOffset: offset + 12_000 < json.length ? offset + 12_000 : null,
    warning: "Read pagination re-executes the query; data may change between requests." };
}
