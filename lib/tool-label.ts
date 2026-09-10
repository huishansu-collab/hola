// Render the actual call arguments; never imply a parameterized call is empty.
export function formatToolCall(name: string, query?: string, bindings?: { variable: string; parameter: string; value: unknown }[]): string {
  if (query === undefined) return name + '()';
  try {
    const args = JSON.parse(query);
    if (bindings?.length && Object.keys(args).length === bindings.length &&
        new Set(bindings.map(b => b.parameter)).size === bindings.length &&
        bindings.every(b => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(b.variable) &&
          Object.hasOwn(args, b.parameter) && JSON.stringify(args[b.parameter]) === JSON.stringify(b.value)))
      return `${name}(${bindings.map(b => b.variable).join(', ')})`;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return `${name}(${JSON.stringify(args)})`;
    return `${name}(${Object.values(args).map(value => JSON.stringify(value)).join(', ')})`;
  } catch {
    return `${name}(${query})`;
  }
}
