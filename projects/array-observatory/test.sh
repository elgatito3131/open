#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$ROOT/scripts/java-tools.sh"
BUILD="$ROOT/build/tests"
mkdir -p "$BUILD"
"$JAVAC" --release 17 --add-modules jdk.httpserver -Xlint:all -d "$BUILD" "$ROOT"/src/observatory/*.java "$ROOT"/tests/observatory/*.java
"$JAVA" --add-modules jdk.httpserver -ea -cp "$BUILD" observatory.DynamicBufferTest
