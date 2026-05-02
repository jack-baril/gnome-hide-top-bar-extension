// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (c) 2013 Thomas Vogt

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const MODIFIER_KEYS = new Set([
  Gdk.KEY_Alt_L,
  Gdk.KEY_Alt_R,
  Gdk.KEY_Caps_Lock,
  Gdk.KEY_Control_L,
  Gdk.KEY_Control_R,
  Gdk.KEY_Hyper_L,
  Gdk.KEY_Hyper_R,
  Gdk.KEY_ISO_Level3_Shift,
  Gdk.KEY_Meta_L,
  Gdk.KEY_Meta_R,
  Gdk.KEY_Num_Lock,
  Gdk.KEY_Shift_L,
  Gdk.KEY_Shift_R,
  Gdk.KEY_Super_L,
  Gdk.KEY_Super_R,
]);

const SHORTCUT_KEY_ID = "shortcut-keybind";

const isModifierKey = (keyval) => MODIFIER_KEYS.has(keyval);

export default class HideTopBarPreferences extends ExtensionPreferences {
  fillPreferencesWindow(prefsWindow) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();

    this._addMouseSensitivityGroup(page, settings);
    this._addHotCornerGroup(page, settings);
    this._addAppearanceGroup(page, settings);
    this._addPressureBarrierGroup(page, settings);
    this._addAnimationGroup(page, settings);
    this._addShortcutGroup(page, settings);
    this._addShortcutBehaviorGroup(page, settings);
    this._addIntellihideGroup(page, settings);

    prefsWindow.add(page);
    prefsWindow.search_enabled = true;
  }

  _addAnimationGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Slide Animation"),
    });

    const overviewAnimRow = new Adw.SpinRow({
      title: _("Overview transition duration"),
      subtitle: _(
        "Duration of the slide animation when entering or exiting the overview, in seconds.",
      ),
      digits: 1,
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 1,
        step_increment: 0.1,
        page_increment: 0.1,
      }),
    });
    settings.bind(
      "animation-time-overview",
      overviewAnimRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(overviewAnimRow);

    const autohideAnimRow = new Adw.SpinRow({
      title: _("Auto-hide transition duration"),
      subtitle: _(
        "Duration of the slide animation when the pointer approaches the screen edge, in seconds",
      ),
      digits: 1,
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 1,
        step_increment: 0.1,
        page_increment: 0.1,
      }),
    });
    settings.bind(
      "animation-time-autohide",
      autohideAnimRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(autohideAnimRow);

    page.add(group);
  }

  _addAppearanceGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Appearance"),
    });

    const keepRoundCornersRow = new Adw.SwitchRow({
      title: _("Preserve rounded corners while the panel is hidden"),
    });
    settings.bind(
      "keep-round-corners",
      keepRoundCornersRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(keepRoundCornersRow);

    page.add(group);
  }

  _addHotCornerGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Hot Corner"),
    });

    const hotCornerRow = new Adw.SwitchRow({
      title: _("Keep the hot corner active while the panel is hidden"),
    });
    settings.bind(
      "hot-corner",
      hotCornerRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(hotCornerRow);

    const mouseTriggersOverviewRow = new Adw.SwitchRow({
      title: _("Open the overview when the hot corner is triggered"),
    });
    settings.bind(
      "mouse-triggers-overview",
      mouseTriggersOverviewRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(mouseTriggersOverviewRow);

    page.add(group);
  }

  _addIntellihideGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Intellihide"),
      description: _(
        "When enabled, the panel will only hide when a window occupies its space",
      ),
    });

    const enableIntellihideRow = new Adw.SwitchRow({
      title: _("Hide panel only when a window occupies its space"),
    });
    settings.bind(
      "enable-intellihide",
      enableIntellihideRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(enableIntellihideRow);

    const enableActiveWindowRow = new Adw.SwitchRow({
      title: _("Hide panel only when the focused window occupies its space"),
    });
    settings.bind(
      "enable-active-window",
      enableActiveWindowRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(enableActiveWindowRow);

    page.add(group);
  }

  _addMouseSensitivityGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Mouse Sensitivity"),
    });

    const mouseSensitiveRow = new Adw.SwitchRow({
      title: _("Reveal panel when the pointer approaches the screen edge"),
    });
    settings.bind(
      "mouse-sensitive",
      mouseSensitiveRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(mouseSensitiveRow);

    const mouseSensitiveFullscreenRow = new Adw.SwitchRow({
      title: _(
        "Reveal panel when the pointer approaches the screen edge while fullscreen",
      ),
    });
    settings.bind(
      "mouse-sensitive-fullscreen-window",
      mouseSensitiveFullscreenRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(mouseSensitiveFullscreenRow);

    const showInOverviewRow = new Adw.SwitchRow({
      title: _("Show panel in the overview"),
    });
    settings.bind(
      "show-in-overview",
      showInOverviewRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(showInOverviewRow);

    page.add(group);
  }

  _addPressureBarrierGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Pressure Barrier"),
    });

    const pressureThresholdRow = new Adw.SpinRow({
      title: _("Pressure threshold"),
      subtitle: _(
        "Number of pixels the pointer must overrun to trigger the barrier",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10000,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    settings.bind(
      "pressure-threshold",
      pressureThresholdRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(pressureThresholdRow);

    const pressureTimeoutRow = new Adw.SpinRow({
      title: _("Pressure timeout"),
      subtitle: _(
        "Duration of sustained pressure required to trigger the barrier.",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10000,
        step_increment: 1,
        page_increment: 10,
      }),
    });
    settings.bind(
      "pressure-timeout",
      pressureTimeoutRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(pressureTimeoutRow);

    page.add(group);
  }

  _addShortcutBehaviorGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Shortcut Behavior"),
    });

    const shortcutDelayRow = new Adw.SpinRow({
      title: _("Auto-hide delay after shortcut activation"),
      subtitle: _(
        "Duration before the panel re-hides after being revealed by the shortcut. A value of 0 disables automatic re-hiding.",
      ),
      digits: 1,
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 10,
        step_increment: 0.1,
        page_increment: 1,
      }),
    });
    settings.bind(
      "shortcut-delay",
      shortcutDelayRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(shortcutDelayRow);

    const shortcutTogglesRow = new Adw.SwitchRow({
      title: _("Allow the shortcut to hide the panel"),
    });
    settings.bind(
      "shortcut-toggles",
      shortcutTogglesRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    group.add(shortcutTogglesRow);

    page.add(group);
  }

  _addShortcutGroup(page, settings) {
    const group = new Adw.PreferencesGroup({
      title: _("Show Panel Shortcut"),
    });

    const shortcutRow = new Adw.ActionRow({
      title: _("Panel toggle shortcut"),
      activatable: true,
    });

    const shortcutLabel = new Gtk.ShortcutLabel({
      disabled_text: _("Disabled"),
      valign: Gtk.Align.CENTER,
    });

    const syncShortcutLabel = () => {
      const [accelerator = ""] = settings.get_strv(SHORTCUT_KEY_ID);
      shortcutLabel.set_accelerator(accelerator);
    };

    syncShortcutLabel();

    const clearShortcutButton = new Gtk.Button({
      icon_name: "edit-clear-symbolic",
      tooltip_text: _("Clear shortcut"),
      valign: Gtk.Align.CENTER,
      css_classes: ["flat"],
    });
    clearShortcutButton.connect("clicked", () => {
      settings.set_strv(SHORTCUT_KEY_ID, []);
      syncShortcutLabel();
    });

    shortcutRow.connect("activated", () => {
      const prefsWindow = shortcutRow.get_root();
      this._promptForShortcut(prefsWindow, settings, syncShortcutLabel);
    });

    settings.connect(`changed::${SHORTCUT_KEY_ID}`, syncShortcutLabel);

    shortcutRow.add_suffix(shortcutLabel);
    shortcutRow.add_suffix(clearShortcutButton);
    group.add(shortcutRow);

    page.add(group);
  }

  _promptForShortcut(parent, settings, onShortcutChanged) {
    const dialog = new Adw.AlertDialog({
      heading: _("Set Shortcut"),
      body: _(
        "Press the key combination you want to assign.\n" +
          "Press Escape to cancel or Backspace to clear the current shortcut.",
      ),
    });

    const statusLabel = new Gtk.ShortcutLabel({
      disabled_text: _("Waiting for input…"),
      accelerator: "",
      halign: Gtk.Align.CENTER,
      margin_top: 12,
      margin_bottom: 12,
    });

    dialog.set_extra_child(statusLabel);

    const keyEventController = new Gtk.EventControllerKey();
    keyEventController.connect(
      "key-pressed",
      (_ctrl, keyval, _keycode, state) => {
        const modifierMask = state & Gtk.accelerator_get_default_mod_mask();

        if (keyval === Gdk.KEY_Escape && modifierMask === 0) {
          dialog.close();
          return true;
        }

        if (keyval === Gdk.KEY_BackSpace && modifierMask === 0) {
          settings.set_strv(SHORTCUT_KEY_ID, []);
          onShortcutChanged();
          dialog.close();
          return true;
        }

        if (isModifierKey(keyval)) {
          return true;
        }

        const accelerator = Gtk.accelerator_name(keyval, modifierMask);
        if (accelerator) {
          settings.set_strv(SHORTCUT_KEY_ID, [accelerator]);
          onShortcutChanged();
        }

        dialog.close();
        return true;
      },
    );

    dialog.add_controller(keyEventController);
    dialog.present(parent);
  }
}
