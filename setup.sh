#!/usr/bin/env bash

set -e

readonly UUID='hide-top-bar@jack-baril'
readonly JS_FILES=(
  desktop-icons.js
  extension.js
  intellihide.js
  panel-visibility-manager.js
  prefs.js
  utils.js
)

build() {
  glib-compile-schemas --strict schemas/
  (cd src && zip -j "../${UUID}.zip" "${JS_FILES[@]}")
  zip "${UUID}.zip" -r LICENSE metadata.json schemas
}

clean() {
  rm -rf "${UUID}.zip" schemas/gschemas.compiled
}

install() {
  gnome-extensions install "${UUID}.zip"
}

uninstall() {
  gnome-extensions uninstall "${UUID}"
}

main() {
  case "${1:-install}" in
    build)
      build
      ;;
    clean)
      clean
      ;;
    install)
      build
      install
      ;;
    uninstall)
      uninstall
      ;;
    *)
      echo "Usage: $0 {build|clean|install|uninstall}" >&2
      exit 1
      ;;
  esac
}

main "$@"
