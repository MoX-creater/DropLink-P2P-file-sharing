import '@testing-library/jest-dom';

// jsdom doesn't implement RTCPeerConnection or WebSocket natively.
// We stub them at the global level here so every test file gets them.
// Individual tests override these with vi.fn() mocks as needed.

if (typeof global.RTCPeerConnection === 'undefined') {
  global.RTCPeerConnection = class {
    constructor() {}
    createOffer() { return Promise.resolve({}); }
    createAnswer() { return Promise.resolve({}); }
    setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    addIceCandidate() { return Promise.resolve(); }
    createDataChannel() { return { onopen: null, onclose: null, onerror: null, readyState: 'open', close() {} }; }
    restartIce() {}
    close() {}
    get iceConnectionState() { return 'new'; }
    set onicecandidate(_) {}
    set oniceconnectionstatechange(_) {}
    set ondatachannel(_) {}
  };
}

if (typeof global.RTCSessionDescription === 'undefined') {
  global.RTCSessionDescription = class {
    constructor(init) { Object.assign(this, init); }
  };
}

if (typeof global.RTCIceCandidate === 'undefined') {
  global.RTCIceCandidate = class {
    constructor(init) { Object.assign(this, init); }
  };
}

if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor() { this.readyState = 1; }
    send() {}
    close() {}
  };
}
