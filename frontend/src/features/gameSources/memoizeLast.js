// Keep the latest prepared shelf alive across room navigation. Inputs include
// catalogue identity and permitted systems; linking/unlinking invalidates it.
export function memoizeLast(build) {
  let previous;
  let result;
  return (...args) => {
    if (!previous || args.length !== previous.length || args.some((arg, i) => arg !== previous[i])) {
      result = build(...args);
      previous = args;
    }
    return result;
  };
}
