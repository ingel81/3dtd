#!/bin/sh
# The game from the release AppImage, unpacked to /opt/3dtd. Started this way
# and not as an AppImage, the app's own updater stays off: pacman updates it.
exec /opt/3dtd/3dtd "$@"
