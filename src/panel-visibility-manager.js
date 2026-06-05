// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2014 Thomas Vogt

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

import * as Layout from "resource:///org/gnome/shell/ui/layout.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PointerWatcher from "resource:///org/gnome/shell/ui/pointerWatcher.js";

import * as DesktopIcons from "./desktop-icons.js";
import * as Intellihide from "./intellihide.js";
import * as Utils from "./utils.js";

const CONNECT_UI_SIGNALS_DELAY_MS = 100;
const HOT_CORNER_BARRIER_DELAY_MS = 100;
const HOT_CORNER_SETTING_CHANGE_HIDE_S = 0.1;
const MINIMUM_SHORTCUT_SHOW_S = 0.1;
const POINTER_POLL_INTERVAL_MS = 10;
const SHORTCUT_HIDE_TIMEOUT_MULTIPLIER_MS_PER_S = 1200;
const SHORTCUT_TOGGLE_THRESHOLD_S = 0.05;
const SIGNALS = {
  CHANGED_ANIMATION_TIME_AUTOHIDE: "changed::animation-time-autohide",
  CHANGED_ANIMATION_TIME_OVERVIEW: "changed::animation-time-overview",
  CHANGED_ENABLE_ACTIVE_WINDOW: "changed::enable-active-window",
  CHANGED_ENABLE_INTELLIHIDE: "changed::enable-intellihide",
  CHANGED_HOT_CORNER: "changed::hot-corner",
  CHANGED_KEEP_ROUND_CORNERS: "changed::keep-round-corners",
  CHANGED_MOUSE_SENSITIVE: "changed::mouse-sensitive",
  CHANGED_MOUSE_SENSITIVE_FULLSCREEN:
    "changed::mouse-sensitive-fullscreen-window",
  CHANGED_MOUSE_TRIGGERS_OVERVIEW: "changed::mouse-triggers-overview",
  CHANGED_PRESSURE_THRESHOLD: "changed::pressure-threshold",
  CHANGED_PRESSURE_TIMEOUT: "changed::pressure-timeout",
  CHANGED_SHORTCUT_DELAY: "changed::shortcut-delay",
  CHANGED_SHORTCUT_TOGGLES: "changed::shortcut-toggles",
  CHANGED_SHOW_IN_OVERVIEW: "changed::show-in-overview",
  HIDING: "hiding",
  LEAVE_EVENT: "leave-event",
  MONITORS_CHANGED: "monitors-changed",
  NOTIFY_ALLOCATION: "notify::allocation",
  NOTIFY_ANCHOR_Y: "notify::anchor-y",
  NOTIFY_HEIGHT: "notify::height",
  OPEN_STATE_CHANGED: "open-state-changed",
  SHOWING: "showing",
  STATUS_CHANGED: "status-changed",
  TRIGGER: "trigger",
};
const ShellActionMode = Shell.ActionMode ?? Shell.KeyBindingMode;
const searchEntryBin = Main.overview._overview._controls._searchEntryBin;

export class PanelVisibilityManager {
  constructor(settings, monitorIndex) {
    this._panelActor = Main.layoutManager.panelBox;
    this._panelBounds = new Clutter.ActorBox();
    this._panelShownY = this._panelActor.y;

    this._activeBlockingMenu = null;
    this._blockingMenuSignalId = 0;
    this._connectUISignalsTimeoutId = 0;
    this._desktopIconsUsableArea =
      new DesktopIcons.DesktopIconsUsableAreaManager();
    this._hotCornerBarrierTimeoutId = 0;
    this._isAnimationActive = false;
    this._lastPanelBounds = null;
    this._lastSearchEntryPadding = null;
    this._monitorIndex = monitorIndex;
    this._panelAllocationSignalHandlerId = 0;
    this._pointerWatchId = null;
    this._pointerWatcher = PointerWatcher.getPointerWatcher();
    this._settings = settings;
    this._settingsSignalGroup = null;
    this._shortcutTimeoutId = 0;
    this._shortcutToggleLatched = false;
    this._shortcutVisibilityOverride = false;
    this._shouldKeepVisible = false;
    this._shouldShowInOverview = true;
    this._uiSignalGroup = null;

    Main.layoutManager.removeChrome(this._panelActor);
    Main.layoutManager.addChrome(this._panelActor, {
      affectsStruts: false,
      trackFullscreen: true,
    });

    if (Main.messageTray?._bannerBin?.ease) {
      this._originalMessageTrayEase = Main.messageTray._bannerBin.ease;
      Main.messageTray._bannerBin.ease = (params) => {
        if (Object.prototype.hasOwnProperty.call(params, "y")) {
          params.y += this._panelActor.y < 0 ? 0 : this._panelActor.height;
        }
        this._originalMessageTrayEase.apply(Main.messageTray._bannerBin, [
          params,
        ]);
      };
    }

    this._hotCornerActor = this._findHotCornerActor();

    this._onEnableActiveWindowChanged =
      this._onEnableActiveWindowChanged.bind(this);
    this._onEnableIntellihideChanged =
      this._onEnableIntellihideChanged.bind(this);
    this._onHotCornerChanged = this._onHotCornerChanged.bind(this);
    this._onHotCornerSettingChanged =
      this._onHotCornerSettingChanged.bind(this);

    this._onMonitorsChanged = this._onMonitorsChanged.bind(this);
    this._onMouseSensitiveChanged = this._onMouseSensitiveChanged.bind(this);

    this._onOverlapChanged = this._onOverlapChanged.bind(this);

    this._onOverviewHiding = this._onOverviewHiding.bind(this);
    this._onOverviewShowing = this._onOverviewShowing.bind(this);
    this._onPanelAllocationChanged = this._onPanelAllocationChanged.bind(this);
    this._onPanelAnchorChanged = this._onPanelAnchorChanged.bind(this);
    this._onPanelHeightChanged = this._onPanelHeightChanged.bind(this);
    this._onPointerLeftPanel = this._onPointerLeftPanel.bind(this);
    this._onPressureThresholdChanged =
      this._onPressureThresholdChanged.bind(this);
    this._onPressureTimeoutChanged = this._onPressureTimeoutChanged.bind(this);
    this._onShortcutActivated = this._onShortcutActivated.bind(this);

    this._onShowInOverviewChanged = this._onShowInOverviewChanged.bind(this);

    this._refreshSettings();
    this._connectSettingsSignals();
    this._syncMouseSensitive();
    this._syncSearchEntryPadding();

    this._intellihide = new Intellihide.Intellihide(
      this._settings,
      this._monitorIndex,
    );

    this._setHotCornerEnabled(true);
    this._updatePanelBounds();
    this._connectUISignalsTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      CONNECT_UI_SIGNALS_DELAY_MS,
      this._connectUISignals.bind(this),
    );
  }

  destroy() {
    if (this._connectUISignalsTimeoutId) {
      GLib.source_remove(this._connectUISignalsTimeoutId);
      this._connectUISignalsTimeoutId = 0;
    }

    if (this._panelAllocationSignalHandlerId) {
      this._panelActor.disconnect(this._panelAllocationSignalHandlerId);
      this._panelAllocationSignalHandlerId = 0;
    }

    this._cancelShortcutTimeout();

    if (this._settingsSignalGroup) {
      this._settingsSignalGroup.destroy();
      this._settingsSignalGroup = null;
    }

    if (this._uiSignalGroup) {
      this._uiSignalGroup.destroy();
      this._uiSignalGroup = null;
    }

    this._intellihide.destroy();
    this._disconnectBlockingMenuSignal();
    Main.wm.removeKeybinding("shortcut-keybind");
    this._destroyPressureBarrier();

    if (this._hotCornerBarrierTimeoutId) {
      GLib.source_remove(this._hotCornerBarrierTimeoutId);
      this._hotCornerBarrierTimeoutId = 0;
    }

    if (searchEntryBin) {
      searchEntryBin.style = null;
    }

    if (this._originalMessageTrayEase) {
      Main.messageTray._bannerBin.ease = this._originalMessageTrayEase;
      this._originalMessageTrayEase = null;
    }

    this.show(0, "destroy");

    Main.layoutManager.removeChrome(this._panelActor);
    Main.layoutManager.addChrome(this._panelActor, {
      affectsStruts: true,
      trackFullscreen: true,
    });

    this._desktopIconsUsableArea.destroy();
    this._desktopIconsUsableArea = null;
  }

  hide(animationTime, reason) {
    Utils.logDebug(`hide(${reason})`);
    if (this._shouldKeepVisible) {
      return;
    }

    const [, anchorY] = this._panelActor.get_pivot_point();
    const deltaY =
      anchorY < 0 ? this._panelActor.height : -this._panelActor.height;
    const [pointerX, pointerY] = global.get_pointer();

    if (reason === "mouse-left" && this._isHovering(pointerX, pointerY)) {
      return;
    }

    this._stopPointerWatch();

    if (this._isAnimationActive) {
      this._panelActor.remove_all_transitions();
      this._isAnimationActive = false;
    }

    this._isAnimationActive = true;
    this._panelActor.ease({
      y: this._panelShownY + deltaY,
      duration: animationTime * 1000,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        this._isAnimationActive = false;
        if (!this._shouldKeepRoundCorners) {
          this._panelActor.hide();
        }
        this._setHotCornerEnabled(false);
      },
    });
  }

  show(animationTime, reason) {
    Utils.logDebug(`show(${reason})`);
    if (reason === "mouse-enter" && this._shouldMouseTriggerOverview) {
      Main.overview.show();
    }

    if (this._isAnimationActive) {
      this._panelActor.remove_all_transitions();
      this._isAnimationActive = false;
    }

    this._setHotCornerEnabled(true);
    this._panelActor.show();

    const [, pointerY] = global.get_pointer();
    const overviewHotCornerCase =
      reason === "showing-overview" &&
      pointerY < this._panelActor.height &&
      this._isHotCornerEnabled;

    if (reason === "destroy" || overviewHotCornerCase) {
      this._panelActor.y = this._panelShownY;
      return;
    }

    this._isAnimationActive = true;
    this._panelActor.ease({
      y: this._panelShownY,
      duration: animationTime * 1000,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        this._isAnimationActive = false;
        this._updatePanelBounds();

        const [pointerX, pointerY] = global.get_pointer();
        if (!this._isHovering(pointerX, pointerY)) {
          this._onPointerLeftPanel();
        } else if (!this._pointerWatchId) {
          this._pointerWatchId = this._pointerWatcher.addWatch(
            POINTER_POLL_INTERVAL_MS,
            this._pollPointerPosition.bind(this),
          );
        }
      },
    });
  }

  _onEnableActiveWindowChanged() {
    this._syncIntellihideEnabled();
  }

  _onEnableIntellihideChanged() {
    this._refreshIntellihideEnabled();
    this._syncIntellihideEnabled();
  }

  _onHotCornerChanged() {
    this._refreshHotCornerEnabled();
    this._onHotCornerSettingChanged();
  }

  _onHotCornerSettingChanged() {
    this.hide(HOT_CORNER_SETTING_CHANGE_HIDE_S, "hot-corner-setting-changed");
  }

  _onMonitorsChanged() {
    this._panelShownY = this._panelActor.y;
    this._hotCornerActor = this._findHotCornerActor();
    this._updatePanelBounds();
    this._syncMouseSensitive();
  }

  _onMouseSensitiveChanged() {
    this._refreshMouseSensitive();
    this._syncMouseSensitive();
  }

  _onOverlapChanged() {
    if (this._shortcutVisibilityOverride) {
      return;
    }

    const overviewVisible = Main.overview.visible;
    this._shouldKeepVisible = !this._intellihide.isOverlapping();

    if (this._shouldKeepVisible) {
      if (this._shouldShowInOverview || !overviewVisible) {
        this.show(this._autohideDuration, "intellihide");
      }
      return;
    }

    if (!overviewVisible) {
      this.hide(this._autohideDuration, "intellihide");
    }
  }

  _onOverviewHiding() {
    this.hide(this._overviewDuration, "hiding-overview");
  }

  _onOverviewShowing() {
    if (this._shouldShowInOverview) {
      this.show(this._overviewDuration, "showing-overview");
    }
  }

  _onPanelAllocationChanged() {
    this._syncIntellihideEnabled();
    if (this._panelAllocationSignalHandlerId) {
      this._panelActor.disconnect(this._panelAllocationSignalHandlerId);
      this._panelAllocationSignalHandlerId = 0;
    }
  }

  _onPanelAnchorChanged() {
    this._updatePanelBounds();
    this._syncMouseSensitive();
  }

  _onPanelHeightChanged() {
    this._syncSearchEntryPadding();
  }

  _onPointerLeftPanel() {
    const overviewVisible = Main.overview.visible;
    if (overviewVisible) {
      return;
    }

    const blockingMenu = Main.panel.menuManager.activeMenu;
    if (blockingMenu === null) {
      this._disconnectBlockingMenuSignal();
      this.hide(this._autohideDuration, "mouse-left");
      return;
    }

    if (
      this._activeBlockingMenu === blockingMenu &&
      this._blockingMenuSignalId > 0
    ) {
      return;
    }

    this._disconnectBlockingMenuSignal();

    this._activeBlockingMenu = blockingMenu;
    this._blockingMenuSignalId = this._activeBlockingMenu.connect(
      SIGNALS.OPEN_STATE_CHANGED,
      (_menu, open) => {
        if (open || this._activeBlockingMenu === null) {
          return;
        }

        this._disconnectBlockingMenuSignal();
        this._onPointerLeftPanel();
      },
    );
  }

  _onPressureThresholdChanged() {
    this._refreshPressureThreshold();
    this._syncMouseSensitive();
  }

  _onPressureTimeoutChanged() {
    this._refreshPressureTimeout();
    this._syncMouseSensitive();
  }

  _onShortcutActivated() {
    const autohideDuration = this._autohideDuration;
    const delayTime = this._shortcutDelay;

    if (this._shortcutToggleLatched || this._shortcutTimeoutId) {
      this._cancelShortcutTimeout();
      this._shortcutToggleLatched = false;

      if (
        delayTime < SHORTCUT_TOGGLE_THRESHOLD_S ||
        this._shouldShortcutToggle
      ) {
        this._shortcutVisibilityOverride = false;
        this._shouldKeepVisible = false;
        this.hide(autohideDuration, "shortcut");
        return;
      }
    }

    if (this._shouldKeepVisible && !this._shortcutVisibilityOverride) {
      return;
    }

    this._shortcutVisibilityOverride = true;
    this._shouldKeepVisible = true;

    if (delayTime > SHORTCUT_TOGGLE_THRESHOLD_S) {
      const showTime = Math.min(
        autohideDuration,
        Math.max(MINIMUM_SHORTCUT_SHOW_S, delayTime / 5.0),
      );

      this.show(showTime, "shortcut");
      this._shortcutTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        delayTime * SHORTCUT_HIDE_TIMEOUT_MULTIPLIER_MS_PER_S,
        () => {
          this._shouldKeepVisible = false;
          this._shortcutVisibilityOverride = false;
          this._onPointerLeftPanel();
          this._shortcutTimeoutId = 0;
          this._shortcutToggleLatched = false;
          return GLib.SOURCE_REMOVE;
        },
      );
      return;
    }

    this.show(autohideDuration, "shortcut");
    this._shortcutToggleLatched = true;
  }

  _onShowInOverviewChanged() {
    this._refreshShowInOverview();
    this._syncSearchEntryPadding();
  }

  _refreshAutohideDuration() {
    this._autohideDuration = this._settings.get_double(
      "animation-time-autohide",
    );
  }

  _refreshHotCornerEnabled() {
    this._isHotCornerEnabled = this._settings.get_boolean("hot-corner");
  }

  _refreshIntellihideEnabled() {
    this._isIntellihideEnabled =
      this._settings.get_boolean("enable-intellihide");
  }

  _refreshKeepRoundCorners() {
    this._shouldKeepRoundCorners =
      this._settings.get_boolean("keep-round-corners");
  }

  _refreshMouseSensitive() {
    this._isMouseSensitive = this._settings.get_boolean("mouse-sensitive");
  }

  _refreshMouseSensitiveInFullscreen() {
    this._isMouseSensitiveInFullscreen = this._settings.get_boolean(
      "mouse-sensitive-fullscreen-window",
    );
  }

  _refreshMouseTriggersOverview() {
    this._shouldMouseTriggerOverview = this._settings.get_boolean(
      "mouse-triggers-overview",
    );
  }

  _refreshOverviewDuration() {
    this._overviewDuration = this._settings.get_double(
      "animation-time-overview",
    );
  }

  _refreshPressureThreshold() {
    this._pressureThreshold = this._settings.get_int("pressure-threshold");
  }

  _refreshPressureTimeout() {
    this._pressureTimeout = this._settings.get_int("pressure-timeout");
  }

  _refreshSettings() {
    this._refreshAutohideDuration();
    this._refreshHotCornerEnabled();
    this._refreshIntellihideEnabled();
    this._refreshKeepRoundCorners();
    this._refreshMouseSensitive();
    this._refreshMouseSensitiveInFullscreen();
    this._refreshMouseTriggersOverview();
    this._refreshOverviewDuration();
    this._refreshPressureThreshold();
    this._refreshPressureTimeout();
    this._refreshShortcutDelay();
    this._refreshShortcutToggles();
    this._refreshShowInOverview();
  }

  _refreshShortcutDelay() {
    this._shortcutDelay = this._settings.get_double("shortcut-delay");
  }

  _refreshShortcutToggles() {
    this._shouldShortcutToggle = this._settings.get_boolean("shortcut-toggles");
  }

  _refreshShowInOverview() {
    this._shouldShowInOverview = this._settings.get_boolean("show-in-overview");
  }

  _syncIntellihideEnabled() {
    if (this._isIntellihideEnabled) {
      this._shortcutVisibilityOverride = false;
      this._shouldKeepVisible = false;
      this._intellihide.startTracking();
      this._intellihide.resetAndEvaluate();
      return;
    }

    this._intellihide.stopTracking();
    this._shortcutVisibilityOverride = true;
    this._shouldKeepVisible = false;
    this.hide(0, "init");
  }

  _syncMouseSensitive() {
    this._destroyPressureBarrier();
    if (this._isMouseSensitive) {
      this._createPressureBarrier();
    }
  }

  _syncSearchEntryPadding() {
    if (!searchEntryBin || !Main.layoutManager.primaryMonitor) {
      return;
    }

    const scale = Main.layoutManager.primaryMonitor.geometry_scale;
    const offset = this._panelActor.height / scale;
    const style = this._shouldShowInOverview
      ? `padding-top: ${offset}px;`
      : null;

    if (style === this._lastSearchEntryPadding) {
      return;
    }

    this._lastSearchEntryPadding = style;
    searchEntryBin.set_style(style);
  }

  _connectSettingsSignals() {
    this._settingsSignalGroup = new Utils.SignalGroup();
    this._settingsSignalGroup._addSignals("settings", [
      [
        this._settings,
        SIGNALS.CHANGED_ANIMATION_TIME_AUTOHIDE,
        this._refreshAutohideDuration.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_ANIMATION_TIME_OVERVIEW,
        this._refreshOverviewDuration.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_ENABLE_ACTIVE_WINDOW,
        this._onEnableActiveWindowChanged,
      ],
      [
        this._settings,
        SIGNALS.CHANGED_ENABLE_INTELLIHIDE,
        this._onEnableIntellihideChanged,
      ],
      [this._settings, SIGNALS.CHANGED_HOT_CORNER, this._onHotCornerChanged],
      [
        this._settings,
        SIGNALS.CHANGED_KEEP_ROUND_CORNERS,
        this._refreshKeepRoundCorners.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_MOUSE_SENSITIVE,
        this._onMouseSensitiveChanged,
      ],
      [
        this._settings,
        SIGNALS.CHANGED_MOUSE_SENSITIVE_FULLSCREEN,
        this._refreshMouseSensitiveInFullscreen.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_MOUSE_TRIGGERS_OVERVIEW,
        this._refreshMouseTriggersOverview.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_PRESSURE_THRESHOLD,
        this._onPressureThresholdChanged,
      ],
      [
        this._settings,
        SIGNALS.CHANGED_PRESSURE_TIMEOUT,
        this._onPressureTimeoutChanged,
      ],
      [
        this._settings,
        SIGNALS.CHANGED_SHORTCUT_DELAY,
        this._refreshShortcutDelay.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_SHORTCUT_TOGGLES,
        this._refreshShortcutToggles.bind(this),
      ],
      [
        this._settings,
        SIGNALS.CHANGED_SHOW_IN_OVERVIEW,
        this._onShowInOverviewChanged,
      ],
    ]);
  }

  _connectUISignals() {
    this._uiSignalGroup = new Utils.SignalGroup();
    this._uiSignalGroup._addSignals("generic", [
      [Main.overview, SIGNALS.HIDING, this._onOverviewHiding],
      [Main.panel, SIGNALS.LEAVE_EVENT, this._onPointerLeftPanel],
      [Main.layoutManager, SIGNALS.MONITORS_CHANGED, this._onMonitorsChanged],
      [this._panelActor, SIGNALS.NOTIFY_ANCHOR_Y, this._onPanelAnchorChanged],
      [this._panelActor, SIGNALS.NOTIFY_HEIGHT, this._onPanelHeightChanged],
      [Main.overview, SIGNALS.SHOWING, this._onOverviewShowing],
      [this._intellihide, SIGNALS.STATUS_CHANGED, this._onOverlapChanged],
    ]);

    Main.wm.addKeybinding(
      "shortcut-keybind",
      this._settings,
      Meta.KeyBindingFlags.NONE,
      ShellActionMode.NORMAL,
      this._onShortcutActivated,
    );

    const hasPanelAllocation = this._panelActor.has_allocation();
    if (!hasPanelAllocation) {
      this._panelAllocationSignalHandlerId = this._panelActor.connect(
        SIGNALS.NOTIFY_ALLOCATION,
        this._onPanelAllocationChanged,
      );
    } else {
      this._syncIntellihideEnabled();
    }

    this._connectUISignalsTimeoutId = 0;
    return GLib.SOURCE_REMOVE;
  }

  _cancelShortcutTimeout() {
    if (this._shortcutTimeoutId) {
      GLib.source_remove(this._shortcutTimeoutId);
      this._shortcutTimeoutId = 0;
    }
  }

  _createPressureBarrier() {
    this._pressureBarrier = new Layout.PressureBarrier(
      this._pressureThreshold,
      this._pressureTimeout,
      ShellActionMode.NORMAL,
    );

    this._pressureBarrier.connect(SIGNALS.TRIGGER, () => {
      const inFullscreen = Main.layoutManager.primaryMonitor?.inFullscreen;
      if (inFullscreen && !this._isMouseSensitiveInFullscreen) {
        return;
      }

      this.show(this._autohideDuration, "mouse-enter");
    });

    const [, anchorY] = this._panelActor.get_pivot_point();
    const direction =
      anchorY < 0
        ? Meta.BarrierDirection.NEGATIVE_Y
        : Meta.BarrierDirection.POSITIVE_Y;

    this._metaBarrier = new Meta.Barrier({
      backend: global.backend,
      x1: this._panelActor.x,
      x2: this._panelActor.x + this._panelActor.width,
      y1: this._panelShownY - anchorY,
      y2: this._panelShownY - anchorY,
      directions: direction,
    });

    this._pressureBarrier.addBarrier(this._metaBarrier);
  }

  _destroyPressureBarrier() {
    this._stopPointerWatch();

    if (this._metaBarrier && this._pressureBarrier) {
      this._pressureBarrier.removeBarrier(this._metaBarrier);
      this._metaBarrier.destroy();
      this._metaBarrier = null;
    }

    if (this._pressureBarrier) {
      this._pressureBarrier = null;
    }
  }

  _disconnectBlockingMenuSignal() {
    if (this._activeBlockingMenu && this._blockingMenuSignalId > 0) {
      this._activeBlockingMenu.disconnect(this._blockingMenuSignalId);
    }

    this._blockingMenuSignalId = 0;
    this._activeBlockingMenu = null;
  }

  _findHotCornerActor() {
    return Main.layoutManager.hotCorners.find(Boolean) ?? null;
  }

  _isHovering(x, y) {
    return (
      y >= this._panelBounds.y1 &&
      y < this._panelBounds.y2 &&
      x >= this._panelBounds.x1 &&
      x < this._panelBounds.x2
    );
  }

  _pollPointerPosition(x, y) {
    if (!this._isAnimationActive && !this._isHovering(x, y)) {
      this._onPointerLeftPanel();
    }
  }

  _setHotCornerEnabled(enabled) {
    if (!this._hotCornerActor) {
      this._hotCornerActor = this._findHotCornerActor();
    }

    if (!this._hotCornerActor) {
      return;
    }

    if (this._hotCornerBarrierTimeoutId) {
      GLib.source_remove(this._hotCornerBarrierTimeoutId);
      this._hotCornerBarrierTimeoutId = 0;
    }

    if (enabled || this._isHotCornerEnabled) {
      this._hotCornerActor.setBarrierSize(this._panelActor.height);
      return;
    }

    this._hotCornerBarrierTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      HOT_CORNER_BARRIER_DELAY_MS,
      () => {
        this._hotCornerActor.setBarrierSize(0);
        this._hotCornerBarrierTimeoutId = 0;
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _stopPointerWatch() {
    if (!this._pointerWatchId) {
      return;
    }

    if (typeof this._pointerWatcher.removeWatch === "function") {
      this._pointerWatcher.removeWatch(this._pointerWatchId);
    } else {
      this._pointerWatcher._removeWatch(this._pointerWatchId);
    }

    this._pointerWatchId = null;
  }

  _updatePanelBounds() {
    Utils.logDebug("_updatePanelBounds()");
    const [, anchorY] = this._panelActor.get_pivot_point();

    const bounds = {
      height: this._panelActor.height,
      width: this._panelActor.width,
      x: this._panelActor.x,
      y: this._panelActor.y - anchorY,
    };

    const lastBounds = this._lastPanelBounds;
    const isUnchanged =
      lastBounds &&
      lastBounds.height === bounds.height &&
      lastBounds.width === bounds.width &&
      lastBounds.x === bounds.x &&
      lastBounds.y === bounds.y;
    if (isUnchanged) {
      return;
    }

    const isHeightChanged = !lastBounds || lastBounds.height !== bounds.height;

    this._lastPanelBounds = bounds;
    this._panelBounds.init_rect(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    );

    this._intellihide.setTargetBox(this._panelBounds);

    if (!isHeightChanged) {
      return;
    }

    this._desktopIconsUsableArea.resetMargins();
    this._desktopIconsUsableArea.setMargins(-1, bounds.height, 0, 0, 0);
  }
}
