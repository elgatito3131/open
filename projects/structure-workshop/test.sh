#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$ROOT/scripts/java-tools.sh"
BUILD="$ROOT/build/tests"
mkdir -p "$BUILD"
"$JAVAC" --release 17 --add-modules jdk.httpserver -Xlint:all -d "$BUILD" "$ROOT"/src/workshop/*.java "$ROOT"/tests/workshop/*.java "$ROOT"/../array-observatory/src/observatory/DynamicBuffer.java
for test in PairLabTest LinkLabTest BranchLabTest DependencyLabTest WorkshopTest; do
  "$JAVA" --add-modules jdk.httpserver -ea -cp "$BUILD" "workshop.$test" "$ROOT"
done

# This negative fixture must fail Java's generic type check.
cp "$ROOT/tests/fixtures/WrongPair.java.txt" "$BUILD/WrongPair.java"
if "$JAVAC" -J-Duser.language=en --release 17 -cp "$BUILD" -d "$BUILD" "$BUILD/WrongPair.java" 2>"$BUILD/type-check.log"; then
  echo "Type-safety check failed: Pair<Integer> accepted a String." >&2
  exit 1
fi
if ! LC_ALL=C grep -q 'String cannot be converted to Integer' "$BUILD/type-check.log"; then
  cat "$BUILD/type-check.log" >&2
  exit 1
fi
echo "Generic type-safety compile check passed."
