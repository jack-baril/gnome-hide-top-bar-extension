// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2014 Thomas Vogt

import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Signals from "resource:///org/gnome/shell/misc/signals.js";

import { getMonitorManager, SignalGroup } from "./utils.js";

const DING_APPLICATION_ID_SET = new Set([
  "com.desktop.ding",
  "com.rastersoft.ding",
]);
const DROPDOWN_TERMINAL_WINDOW_CLASS_ID = "DropDownTerminalWindow";
const OVERLAP_CHECK_INTERVAL_MS = 100;

export const OverlapStatus = {
  FALSE: 0,
  TRUE: 1,
  UNINITIALIZED: -1,
};

export const TRACKED_WINDOW_TYPES = [
  Meta.WindowType.DIALOG,
  Meta.WindowType.DOCK,
  Meta.WindowType.MENU,
  Meta.WindowType.MODAL_DIALOG,
  Meta.WindowType.NORMAL,
  Meta.WindowType.SPLASHSCREEN,
  Meta.WindowType.TOOLBAR,
  Meta.WindowType.UTILITY,
];

const TRACKED_WINDOW_TYPES_SET = new Set(TRACKED_WINDOW_TYPES);

export class Intellihide extends Signals.EventEmitter {
  constructor(settings, monitorIndex) {
    super();

    this._eligibleWindowActors = [];
    this._eligibleWindowActorsByApp = new Map();
    this._eligibleWindowAppsByActor = new Map();
    this._focusApp = null;
    this._focusAppResolved = null;
    this._focusWindow = null;
    this._isActiveWindowEnabled = false;
    this._isTracking = false;
    this._messageTrayBannerBin = Main.messageTray?._bannerBin ?? null;
    this._messageTrayRect = null;
    this._messageTrayVisible = Main.messageTray.visible;
    this._monitorIndex = monitorIndex;
    this._overlapStatus = OverlapStatus.UNINITIALIZED;
    this._overlapTimeoutId = 0;
    this._panelBounds = null;
    this._primaryWindowActors = [];
    this._primaryWindowActorsByActor = new Map();
    this._settings = settings;
    this._signalGroup = new SignalGroup();
    this._stackedWindowActors = null;
    this._topApp = null;
    this._topTrackedWindow = null;
    this._trackedWindowActors = new Set();
    this._tracker = Shell.WindowTracker.get_default();
    this._windowActorSignals = new Map();
    this._windowAppByActor = new Map();
    this._windowDestroySignals = new Map();
    this._windowMetaSignals = new Map();
    this._windowRectByActor = new Map();

    this._refreshSettings();

    this._signalGroup._addSignals("generic", [
      [
        this._settings,
        "changed::enable-active-window",
        this._refreshSettings.bind(this),
      ],
      [Main.messageTray, "hide", this._onMessageTrayHidden.bind(this)],
      [Main.messageTray, "show", this._onMessageTrayShown.bind(this)],
      [
        getMonitorManager(),
        "monitors-changed",
        this._onMonitorsChanged.bind(this),
      ],
      [
        global.workspace_manager,
        "active-workspace-changed",
        this._onActiveWorkspaceChanged.bind(this),
      ],
      [global.display, "notify::focus-window", this._onFocusChanged.bind(this)],
      [this._tracker, "notify::focus-app", this._onFocusChanged.bind(this)],
      [global.display, "restacked", this._onRestacked.bind(this)],
      [global.display, "window-created", this._windowCreated.bind(this)],
    ]);
  }

  destroy() {
    this._signalGroup.destroy();
    this.stopTracking();
  }

  isOverlapping() {
    return this._overlapStatus === OverlapStatus.TRUE;
  }

  resetAndEvaluate() {
    this._overlapStatus = OverlapStatus.UNINITIALIZED;
    this._evaluateOverlap();
  }

  setTargetBox(box) {
    this._panelBounds = box;
    this._scheduleOverlapCheck();
  }

  startTracking() {
    this._eligibleWindowActors.length = 0;
    this._eligibleWindowActorsByApp.clear();
    this._eligibleWindowAppsByActor.clear();
    this._isTracking = true;
    this._messageTrayVisible = Main.messageTray.visible;
    this._overlapStatus = OverlapStatus.UNINITIALIZED;
    this._primaryWindowActors.length = 0;
    this._primaryWindowActorsByActor.clear();
    this._stackedWindowActors = null;
    this._trackedWindowActors.clear();
    this._windowRectByActor.clear();

    const windowActors = global.get_window_actors();
    for (const windowActor of windowActors) {
      this._addWindowSignals(windowActor);
    }

    this._stackedWindowActors = windowActors;
    this._refreshEligibleWindowActors();
    this._refreshFocusState();
    this._refreshTopTrackedWindow();
    this._updatePrimaryWindowActors();
    this._evaluateOverlap();
  }

  stopTracking() {
    this._isTracking = false;

    for (const windowActor of this._windowActorSignals.keys()) {
      this._removeWindowSignals(windowActor);
    }

    this._eligibleWindowActors.length = 0;
    this._eligibleWindowActorsByApp.clear();
    this._eligibleWindowAppsByActor.clear();
    this._focusApp = null;
    this._focusAppResolved = null;
    this._focusWindow = null;
    this._messageTrayRect = null;
    this._messageTrayVisible = Main.messageTray.visible;
    this._primaryWindowActors.length = 0;
    this._primaryWindowActorsByActor.clear();
    this._stackedWindowActors = null;
    this._topApp = null;
    this._topTrackedWindow = null;
    this._trackedWindowActors.clear();
    this._windowAppByActor.clear();
    this._windowRectByActor.clear();

    if (this._overlapTimeoutId > 0) {
      GLib.source_remove(this._overlapTimeoutId);
      this._overlapTimeoutId = 0;
    }
  }

  _onActiveWorkspaceChanged() {
    this._refreshEligibleWindowActors();
    this._updatePrimaryWindowActors();
    this._scheduleOverlapCheck();
  }

  _onFocusChanged() {
    this._refreshFocusState();
    this._updatePrimaryWindowActors();
    this._scheduleOverlapCheck();
  }

  _onMessageTrayHidden() {
    this._messageTrayRect = null;
    this._messageTrayVisible = false;
    this._scheduleOverlapCheck();
  }

  _onMessageTrayShown() {
    this._messageTrayRect =
      this._messageTrayBannerBin?.get_allocation_box() ?? null;
    this._messageTrayVisible = true;
    this._scheduleOverlapCheck();
  }

  _onMonitorsChanged() {
    this._refreshEligibleWindowActors();
    this._refreshStackedWindowActors();
    this._refreshTopTrackedWindow();
    this._updatePrimaryWindowActors();
    this._scheduleOverlapCheck();
  }

  _onRestacked() {
    this._refreshStackedWindowActors();
    this._refreshTopTrackedWindow();
    this._scheduleOverlapCheck();
  }

  _windowCreated(_display, metaWindow) {
    const windowActor = metaWindow.get_compositor_private();
    if (!windowActor) {
      return;
    }

    this._addWindowSignals(windowActor);
    this._refreshEligibleWindowActors();
    this._refreshStackedWindowActors();
    this._refreshTopTrackedWindow();
    this._updatePrimaryWindowActors();
    this._scheduleOverlapCheck();
  }

  _evaluateOverlap() {
    if (!this._isTracking || this._panelBounds === null) {
      return;
    }

    const eligibleWindowActors = this._eligibleWindowActors;
    const eligibleWindowAppsByActor = this._eligibleWindowAppsByActor;
    const messageTrayVisible = this._messageTrayVisible;
    const trackedWindowActors = this._trackedWindowActors;

    let overlapStatus = OverlapStatus.FALSE;

    if (trackedWindowActors.size === 0 && !messageTrayVisible) {
      if (this._overlapStatus !== overlapStatus) {
        this._overlapStatus = overlapStatus;
        this.emit("status-changed", this._overlapStatus);
      }
      return;
    }

    if (messageTrayVisible && this._messageTrayBannerBin) {
      if (!this._messageTrayRect) {
        this._messageTrayRect = this._messageTrayBannerBin.get_allocation_box();
      }

      if (
        this._messageTrayRect &&
        this._rectOverlapsPanel(this._messageTrayRect, this._panelBounds)
      ) {
        overlapStatus = OverlapStatus.TRUE;
      }
    }

    if (overlapStatus === OverlapStatus.FALSE && this._topTrackedWindow) {
      const focusApp = this._focusAppResolved;
      const focusWindow = this._focusWindow;
      const panelBounds = this._panelBounds;
      const topApp = this._topApp;
      const overlapCandidates = this._isActiveWindowEnabled
        ? this._primaryWindowActors
        : eligibleWindowActors;

      if (
        this._evaluateOverlapForWindowActors(
          overlapCandidates,
          eligibleWindowAppsByActor,
          focusApp,
          focusWindow,
          panelBounds,
          topApp,
        )
      ) {
        overlapStatus = OverlapStatus.TRUE;
      } else if (this._isActiveWindowEnabled && focusApp) {
        if (
          this._evaluateOverlapForWindowActors(
            eligibleWindowActors,
            eligibleWindowAppsByActor,
            focusApp,
            focusWindow,
            panelBounds,
            topApp,
            this._primaryWindowActorsByActor,
          )
        ) {
          overlapStatus = OverlapStatus.TRUE;
        }
      }
    }

    if (this._overlapStatus !== overlapStatus) {
      this._overlapStatus = overlapStatus;
      this.emit("status-changed", this._overlapStatus);
    }
  }

  _refreshFocusState() {
    this._focusApp = this._tracker.focus_app ?? null;
    this._focusWindow = global.display.get_focus_window();
    this._focusAppResolved = this._focusApp ?? this._topApp;
  }

  _refreshSettings() {
    this._isActiveWindowEnabled = this._settings.get_boolean(
      "enable-active-window",
    );
  }

  _scheduleOverlapCheck() {
    if (!this._isTracking || this._panelBounds === null) {
      return;
    }

    if (this._overlapTimeoutId) {
      GLib.source_remove(this._overlapTimeoutId);
      this._overlapTimeoutId = 0;
    }

    this._overlapTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      OVERLAP_CHECK_INTERVAL_MS,
      () => {
        this._overlapTimeoutId = 0;
        this._evaluateOverlap();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _addWindowSignals(windowActor) {
    if (!this._isTracking) {
      return;
    }

    if (!windowActor || this._windowActorSignals.has(windowActor)) {
      return;
    }

    if (!this._isTrackableWindowActor(windowActor)) {
      return;
    }

    this._trackedWindowActors.add(windowActor);

    const allocationSignalId = windowActor.connect("notify::allocation", () => {
      this._onTrackedWindowAllocationChanged(windowActor);
    });
    this._windowActorSignals.set(windowActor, allocationSignalId);

    const destroySignalId = windowActor.connect("destroy", () => {
      this._removeWindowSignals(windowActor);
    });
    this._windowDestroySignals.set(windowActor, destroySignalId);

    const metaWindow = windowActor.get_meta_window();
    if (!metaWindow) {
      return;
    }

    this._windowRectByActor.set(windowActor, metaWindow.get_frame_rect());
    this._windowAppByActor.set(
      windowActor,
      this._tracker.get_window_app(metaWindow) ?? null,
    );

    const monitorSignalId = metaWindow.connect("notify::monitor", () => {
      this._onTrackedWindowMetaChanged();
    });
    const workspaceSignalId = metaWindow.connect("notify::workspace", () => {
      this._onTrackedWindowMetaChanged();
    });
    this._windowMetaSignals.set(windowActor, {
      metaWindow,
      monitorSignalId,
      workspaceSignalId,
    });
  }

  _evaluateOverlapForWindowActors(
    windowActors,
    eligibleWindowAppsByActor,
    focusApp,
    focusWindow,
    panelBounds,
    topApp,
    skipWindowActorMap = null,
  ) {
    for (const windowActor of windowActors) {
      if (skipWindowActorMap?.has(windowActor)) {
        continue;
      }

      const metaWindow = windowActor.get_meta_window();
      if (!metaWindow) {
        continue;
      }

      const currentApp = eligibleWindowAppsByActor.get(windowActor) ?? null;
      if (
        !this._shouldIncludeMetaWindowInOverlapCheck(
          metaWindow,
          currentApp,
          focusApp,
          focusWindow,
          topApp,
        )
      ) {
        continue;
      }

      const isMinimized =
        typeof metaWindow.minimized === "boolean"
          ? metaWindow.minimized
          : (metaWindow.is_minimized?.() ?? false);
      if (isMinimized) {
        continue;
      }

      let windowRect = this._windowRectByActor.get(windowActor);
      if (!windowRect) {
        windowRect = metaWindow.get_frame_rect();
        this._windowRectByActor.set(windowActor, windowRect);
      }

      if (this._rectOverlapsPanel(windowRect, panelBounds)) {
        return true;
      }
    }

    return false;
  }

  _findTopTrackedWindow(windowActors) {
    const monitorIndex = this._monitorIndex;
    for (let i = windowActors.length - 1; i >= 0; i -= 1) {
      const windowActor = windowActors[i];
      const metaWindow = windowActor.get_meta_window();
      if (!metaWindow) {
        continue;
      }

      if (
        this._isTrackableMetaWindow(metaWindow) &&
        metaWindow.get_monitor() === monitorIndex
      ) {
        return metaWindow;
      }
    }

    return null;
  }

  _onTrackedWindowAllocationChanged(windowActor) {
    const metaWindow = windowActor.get_meta_window();
    if (!metaWindow) {
      return;
    }

    this._windowRectByActor.set(windowActor, metaWindow.get_frame_rect());
    this._scheduleOverlapCheck();
  }

  _onTrackedWindowMetaChanged() {
    this._refreshEligibleWindowActors();
    this._updatePrimaryWindowActors();
    this._scheduleOverlapCheck();
  }

  _refreshEligibleWindowActors() {
    if (!this._isTracking) {
      this._eligibleWindowActors.length = 0;
      this._eligibleWindowActorsByApp.clear();
      this._eligibleWindowAppsByActor.clear();
      return;
    }

    const currentWorkspaceIndex =
      global.workspace_manager.get_active_workspace_index();
    const eligibleWindowActors = this._eligibleWindowActors;
    const eligibleWindowActorsByApp = this._eligibleWindowActorsByApp;
    const eligibleWindowAppsByActor = this._eligibleWindowAppsByActor;
    const monitorIndex = this._monitorIndex;
    const trackedWindowActors = this._trackedWindowActors;

    eligibleWindowActors.length = 0;
    eligibleWindowActorsByApp.clear();
    eligibleWindowAppsByActor.clear();

    for (const windowActor of trackedWindowActors) {
      const metaWindow = windowActor.get_meta_window();
      if (!metaWindow) {
        continue;
      }

      if (metaWindow.get_monitor() !== monitorIndex) {
        continue;
      }

      const workspace = metaWindow.get_workspace();
      if (!workspace) {
        continue;
      }

      const workspaceIndex = workspace.index();
      if (
        workspaceIndex !== currentWorkspaceIndex ||
        !metaWindow.showing_on_its_workspace()
      ) {
        continue;
      }

      let windowApp = this._windowAppByActor.get(windowActor);
      if (typeof windowApp === "undefined") {
        windowApp = this._tracker.get_window_app(metaWindow) ?? null;
        this._windowAppByActor.set(windowActor, windowApp);
      }

      if (windowApp) {
        const windowActorsForApp =
          eligibleWindowActorsByApp.get(windowApp) ?? [];
        windowActorsForApp.push(windowActor);
        eligibleWindowActorsByApp.set(windowApp, windowActorsForApp);
      }

      eligibleWindowAppsByActor.set(windowActor, windowApp);
      eligibleWindowActors.push(windowActor);
    }
  }

  _refreshStackedWindowActors() {
    this._stackedWindowActors = global.get_window_actors();
  }

  _refreshTopTrackedWindow() {
    if (!this._isTracking) {
      this._topTrackedWindow = null;
      return;
    }

    if (!this._stackedWindowActors) {
      this._refreshStackedWindowActors();
    }

    const windowActors = this._stackedWindowActors ?? [];
    this._topTrackedWindow = this._findTopTrackedWindow(windowActors);
    this._topApp = this._topTrackedWindow
      ? this._tracker.get_window_app(this._topTrackedWindow)
      : null;
    this._focusAppResolved = this._focusApp ?? this._topApp;
  }

  _removeWindowSignals(windowActor) {
    const metaWindow = windowActor.get_meta_window();
    const shouldRefreshTop =
      Boolean(metaWindow) && metaWindow === this._topTrackedWindow;

    this._trackedWindowActors.delete(windowActor);
    this._windowAppByActor.delete(windowActor);
    this._windowRectByActor.delete(windowActor);

    const allocationSignalId = this._windowActorSignals.get(windowActor);
    if (allocationSignalId) {
      windowActor.disconnect(allocationSignalId);
      this._windowActorSignals.delete(windowActor);
    }

    const destroySignalId = this._windowDestroySignals.get(windowActor);
    if (destroySignalId) {
      windowActor.disconnect(destroySignalId);
      this._windowDestroySignals.delete(windowActor);
    }

    const metaSignalEntry = this._windowMetaSignals.get(windowActor);
    if (metaSignalEntry?.metaWindow) {
      const { metaWindow: trackedMetaWindow } = metaSignalEntry;
      trackedMetaWindow.disconnect(metaSignalEntry.monitorSignalId);
      trackedMetaWindow.disconnect(metaSignalEntry.workspaceSignalId);
    }
    this._windowMetaSignals.delete(windowActor);

    this._refreshEligibleWindowActors();
    this._updatePrimaryWindowActors();

    if (shouldRefreshTop) {
      this._stackedWindowActors = null;
      this._refreshTopTrackedWindow();
    }
  }

  _updatePrimaryWindowActors() {
    const eligibleWindowActorsByApp = this._eligibleWindowActorsByApp;
    const focusApp = this._focusAppResolved;
    const primaryWindowActors = this._primaryWindowActors;
    const primaryWindowActorsByActor = this._primaryWindowActorsByActor;
    const topApp = this._topApp;

    primaryWindowActors.length = 0;
    primaryWindowActorsByActor.clear();

    if (!this._isActiveWindowEnabled || !focusApp) {
      return;
    }

    const focusWindowActors = eligibleWindowActorsByApp.get(focusApp) ?? [];
    const topWindowActors =
      topApp && topApp !== focusApp
        ? (eligibleWindowActorsByApp.get(topApp) ?? [])
        : [];

    for (const windowActor of focusWindowActors) {
      primaryWindowActors.push(windowActor);
      primaryWindowActorsByActor.set(windowActor, true);
    }

    for (const windowActor of topWindowActors) {
      if (!primaryWindowActorsByActor.has(windowActor)) {
        primaryWindowActors.push(windowActor);
        primaryWindowActorsByActor.set(windowActor, true);
      }
    }
  }

  _isTrackableMetaWindow(metaWindow) {
    const gtkApplicationId = metaWindow.get_gtk_application_id();
    const dingApplication = DING_APPLICATION_ID_SET.has(gtkApplicationId);
    const skipTaskbar = metaWindow.is_skip_taskbar();
    if (dingApplication && skipTaskbar) {
      return false;
    }

    const dropDownTerminal =
      metaWindow.get_wm_class() === DROPDOWN_TERMINAL_WINDOW_CLASS_ID;
    if (dropDownTerminal) {
      return true;
    }

    const windowType = metaWindow.get_window_type();
    return TRACKED_WINDOW_TYPES_SET.has(windowType);
  }

  _isTrackableWindowActor(windowActor) {
    if (!windowActor) {
      return false;
    }

    const metaWindow = windowActor.get_meta_window();
    if (!metaWindow) {
      return false;
    }

    return this._isTrackableMetaWindow(metaWindow);
  }

  _rectOverlapsPanel(rect, panelBounds) {
    return (
      rect.x < panelBounds.x2 &&
      rect.x + rect.width > panelBounds.x1 &&
      rect.y < panelBounds.y2 &&
      rect.y + rect.height > panelBounds.y1
    );
  }

  _shouldIncludeMetaWindowInOverlapCheck(
    metaWindow,
    currentApp,
    focusApp,
    focusWindow,
    topApp,
  ) {
    if (this._isActiveWindowEnabled && focusApp) {
      const dropDownTerminal =
        metaWindow.get_wm_class() === DROPDOWN_TERMINAL_WINDOW_CLASS_ID;
      if (dropDownTerminal) {
        return true;
      }

      const splitWindowSpecialCase =
        Boolean(focusWindow) &&
        focusWindow.maximized_vertically &&
        !focusWindow.maximized_horizontally &&
        metaWindow.maximized_vertically &&
        !metaWindow.maximized_horizontally &&
        metaWindow.get_monitor() === focusWindow.get_monitor();

      if (
        currentApp !== focusApp &&
        currentApp !== topApp &&
        !splitWindowSpecialCase &&
        !metaWindow.is_above()
      ) {
        return false;
      }
    }

    return true;
  }
}
