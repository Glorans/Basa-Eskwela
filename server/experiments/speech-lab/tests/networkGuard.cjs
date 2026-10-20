"use strict";
// Preload for offline verification: only loopback test HTTP is allowed.
const net = require("node:net");
const tls = require("node:tls");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === "object" ? options.host || "localhost" : typeof args[1] === "string" ? args[1] : "localhost";
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Offline Speech Lab verification blocked external networking");
  return original.apply(this, args);
};
tls.connect = () => { throw new Error("Offline Speech Lab verification blocked TLS networking"); };
global.fetch = () => { throw new Error("Offline Speech Lab verification blocked fetch"); };
