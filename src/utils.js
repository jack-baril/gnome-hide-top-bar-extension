// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2013 Thomas Vogt

import Meta from "gi://Meta";

const isDebugEnabled = false;

export function getMonitorManager() {
  if (typeof global.backend.get_monitor_manager === "function") {
    return global.backend.get_monitor_manager();
  }

  return Meta.MonitorManager.get();
}

export const logDebug = (message) => {
  if (!isDebugEnabled) {
    return;
  }

  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`${timestamp} [hide-top-bar]: ${message}`);
};

export class SignalGroup {
  constructor() {
    this._signalsByLabel = new Map();
  }

  destroy() {
    for (const label of this._signalsByLabel.keys()) {
      this.removeWithLabel(label);
    }
  }

  removeWithLabel(label) {
    const signalEntries = this._signalsByLabel.get(label);
    if (!signalEntries) {
      return;
    }

    for (const [object, signalId] of signalEntries) {
      object.disconnect(signalId);
    }

    this._signalsByLabel.delete(label);
  }

  _addSignals(label, signalDefinitions) {
    const signalEntries = this._signalsByLabel.get(label) ?? [];
    this._signalsByLabel.set(label, signalEntries);

    for (const [object, event, callback] of signalDefinitions) {
      const signalId = object.connect(event, callback);
      signalEntries.push([object, signalId]);
    }
  }
}
