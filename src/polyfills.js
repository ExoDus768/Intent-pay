import * as bufferModule from 'buffer';

// Some NEAR wallet-selector dependencies still expect Node's Buffer module
// to exist as a browser global. Load this before the wallet modules.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = bufferModule.Buffer;
}
if (typeof globalThis.buffer === 'undefined') {
  globalThis.buffer = bufferModule;
}
