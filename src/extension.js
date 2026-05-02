// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2013 Thomas Vogt

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { PanelVisibilityManager } from "./panel-visibility-manager.js";
import { logDebug } from "./utils.js";

export default class HideTopBarExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    this._panelVisibilityManager = null;
    this._primaryMonitorIndex = null;
    this._settings = null;
  }

  disable() {
    logDebug("disable()");

    this._panelVisibilityManager?.destroy();
    this._panelVisibilityManager = null;
    this._primaryMonitorIndex = null;
    this._settings = null;
  }

  enable() {
    logDebug("enable()");

    this._primaryMonitorIndex = Main.layoutManager.primaryIndex;
    this._settings = this.getSettings();
    this._panelVisibilityManager = new PanelVisibilityManager(
      this._settings,
      this._primaryMonitorIndex,
    );
  }
}
