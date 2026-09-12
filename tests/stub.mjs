// Shared browser-global shim for the standalone tests in this directory.
// Reuses the same DOM/window/localStorage/etc. stand-ins the runtime
// smoke tests already rely on, so there's one shim, not two.
import './runtime/dom-harness.mjs';
