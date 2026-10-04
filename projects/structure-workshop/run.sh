#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$ROOT/scripts/java-tools.sh"
BUILD="$ROOT/build/classes"
mkdir -p "$BUILD"
"$JAVAC" --release 17 --add-modules jdk.httpserver -d "$BUILD" "$ROOT"/src/workshop/*.java "$ROOT"/../array-observatory/src/observatory/DynamicBuffer.java
exec "$JAVA" --add-modules jdk.httpserver -cp "$BUILD" workshop.WorkshopServer "$ROOT"
