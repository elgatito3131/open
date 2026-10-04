#!/bin/sh
# Shared JDK selection. A configured JAVA_HOME wins; otherwise use PATH.
if [ -n "${JAVA_HOME:-}" ]; then
  JAVA="$JAVA_HOME/bin/java"
  JAVAC="$JAVA_HOME/bin/javac"
else
  JAVA="java"
  JAVAC="javac"
fi

if ! "$JAVAC" -version >/dev/null 2>&1; then
  echo "A JDK (Java 17 or newer) is required. Set JAVA_HOME or add its bin folder to PATH." >&2
  exit 1
fi
