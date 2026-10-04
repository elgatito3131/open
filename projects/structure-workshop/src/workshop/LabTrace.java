package workshop;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;

/** Immutable trace metadata; engines copy their visual state into each frame. */
public record LabTrace(List<String> operations, List<Frame> frames) {
    public LabTrace {
        operations = List.copyOf(operations);
        frames = List.copyOf(frames);
        if (frames.isEmpty()) throw new IllegalArgumentException("A trace needs an initial frame.");
    }

    public record Frame(int operationIndex, String operation, String phase,
            String title, String message, String note, String sourceId,
            Map<String, Object> view) {
        public Frame { view = freezeMap(view); }
    }

    private static Map<String, Object> freezeMap(Map<?, ?> input) {
        Map<String, Object> copy = new LinkedHashMap<>();
        input.forEach((key, value) -> copy.put(key.toString(), freeze(value)));
        return Collections.unmodifiableMap(copy);
    }
    private static Object freeze(Object value) {
        if (value instanceof Map<?, ?> map) return freezeMap(map);
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>();
            for (Object item : list) copy.add(freeze(item));
            return Collections.unmodifiableList(copy);
        }
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) return value;
        throw new IllegalArgumentException("Snapshot values must be JSON-compatible.");
    }
}
