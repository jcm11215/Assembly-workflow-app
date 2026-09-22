// The scan modules keep answers in IndexedDB when the browser has it and
// fall back to memory when it doesn't. Node has no IndexedDB, so these
// tests exercise the memory path; nothing else from the browser is used.
globalThis.indexedDB = undefined;
