// SPDX-License-Identifier: BSD-1-Clause
// Copyright (c) 2021 Sergio Costas

import GLib from "gi://GLib";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as ExtensionUtils from "resource:///org/gnome/shell/misc/extensionUtils.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const DESKTOP_ICONS_EXTENSION_UUID = "130cbc66-235c-4bd6-8571-98d2d8bba5e2";
const MARGINS_SYNC_DELAY_MS = 100;

export class DesktopIconsUsableAreaManager {
  constructor() {
    const extension = Extension.lookupByURL(import.meta.url);

    this._extensionManager = Main.extensionManager;
    this._hideTopBarExtensionUuid = extension.uuid;
    this._marginSyncTimeoutId = 0;
    this._marginsByMonitorIndex = {};

    this._extensionManagerSignalId = this._extensionManager.connect(
      "extension-state-changed",
      (_obj, shellExtension) => {
        if (!shellExtension) {
          return;
        }

        const isExtensionRunning = this._isExtensionRunning(shellExtension);
        if (isExtensionRunning) {
          this._sendMarginsToExtension(shellExtension);
          return;
        }

        this._scheduleMarginSync();
      },
    );
  }

  destroy() {
    if (this._extensionManagerSignalId) {
      this._extensionManager.disconnect(this._extensionManagerSignalId);
      this._extensionManagerSignalId = 0;
    }

    if (this._marginSyncTimeoutId) {
      GLib.source_remove(this._marginSyncTimeoutId);
      this._marginSyncTimeoutId = 0;
    }

    this._marginsByMonitorIndex = {};
  }

  resetMargins() {
    this._marginsByMonitorIndex = {};
    this._scheduleMarginSync();
  }

  setMargins(monitor, top, bottom, left, right) {
    let margins = this._marginsByMonitorIndex[monitor];
    if (!margins) {
      margins = { top, bottom, left, right };
      this._marginsByMonitorIndex[monitor] = margins;
    } else {
      const isUnchanged =
        margins.top === top &&
        margins.bottom === bottom &&
        margins.left === left &&
        margins.right === right;
      if (isUnchanged) {
        return;
      }

      margins.top = top;
      margins.bottom = bottom;
      margins.left = left;
      margins.right = right;
    }

    this._scheduleMarginSync();
  }

  _isDesktopIconsExtension(shellExtension) {
    return (
      shellExtension?.stateObj?.DesktopIconsUsableArea?.uuid ===
      DESKTOP_ICONS_EXTENSION_UUID
    );
  }

  _isExtensionRunning(shellExtension) {
    return (
      shellExtension?.state === ExtensionUtils.ExtensionState.ENABLED ||
      shellExtension?.state === ExtensionUtils.ExtensionState.ACTIVE
    );
  }

  _scheduleMarginSync() {
    if (this._marginSyncTimeoutId) {
      GLib.source_remove(this._marginSyncTimeoutId);
    }

    this._marginSyncTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MARGINS_SYNC_DELAY_MS,
      () => {
        this._sendMarginsToAll();
        this._marginSyncTimeoutId = 0;
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _sendMarginsToAll() {
    const extensionManager = this._extensionManager;
    for (const uuid of extensionManager.getUuids()) {
      this._sendMarginsToExtension(extensionManager.lookup(uuid));
    }
  }

  _sendMarginsToExtension(shellExtension) {
    const isExtensionRunning = this._isExtensionRunning(shellExtension);
    const isDesktopIconsExtension =
      this._isDesktopIconsExtension(shellExtension);
    if (!isExtensionRunning || !isDesktopIconsExtension) {
      return;
    }

    const desktopIconsUsableArea =
      shellExtension?.stateObj?.DesktopIconsUsableArea;
    if (!desktopIconsUsableArea) {
      return;
    }

    desktopIconsUsableArea.setMarginsForExtension(
      this._hideTopBarExtensionUuid,
      this._marginsByMonitorIndex,
    );
  }
}
