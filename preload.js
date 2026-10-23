"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("mdlens", {
  invoke: (cmd, args) => ipcRenderer.invoke(cmd, args),
  win: (action) => ipcRenderer.send("win", action),
  listen: (channel, fn) => ipcRenderer.on(channel, (_e, payload) => fn(payload)),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
