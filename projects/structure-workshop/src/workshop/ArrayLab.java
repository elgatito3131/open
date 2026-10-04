package workshop;

import observatory.DynamicBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Adapts the existing, tested array engine without duplicating its implementation. */
public final class ArrayLab {
    private ArrayLab() {}
    public static LabTrace run(String initial, String instructions) {
        List<Integer> values = new ArrayList<>();
        if (!initial.isBlank()) for (String token : initial.split(",", -1)) values.add(integer(token.strip()));
        if (values.size() > 16) throw new IllegalArgumentException("Use at most 16 initial values.");
        List<String> commands = instructions.lines().map(String::strip).filter(s -> !s.isEmpty()).toList();
        if (commands.size() > 24) throw new IllegalArgumentException("Use at most 24 instructions.");
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(values, DynamicBuffer.Growth.DOUBLE);
        List<LabTrace.Frame> frames = new ArrayList<>();
        frames.add(new LabTrace.Frame(-1, "", "initial", "Before the first instruction",
            "The initial values are stored in the Java array.", "Size counts values; capacity counts all slots.", null,
            view(buffer.snapshot().slots(), buffer.size(), buffer.capacity(), null, List.of())));
        for (int i = 0; i < commands.size(); i++) {
            String[] p = commands.get(i).split("\\s+");
            try {
                switch (p[0]) {
                    case "append" -> { length(p, 2); buffer.append(integer(p[1])); }
                    case "insert" -> { length(p, 3); buffer.insert(integer(p[1]), integer(p[2])); }
                    case "remove" -> { length(p, 2); buffer.remove(integer(p[1])); }
                    case "set" -> { length(p, 3); buffer.set(integer(p[1]), integer(p[2])); }
                    default -> throw new IllegalArgumentException("Use append, insert, remove, or set.");
                }
            } catch (IllegalArgumentException | IndexOutOfBoundsException | IllegalStateException error) {
                throw new IllegalArgumentException("Instruction " + (i + 1) + ": " + error.getMessage());
            }
        }
        for (int i = 0; i < buffer.steps().size(); i++) {
            DynamicBuffer.Step<Integer> s = buffer.steps().get(i);
            boolean growing = s.phase().equals("commit") && i + 1 < buffer.steps().size()
                && buffer.steps().get(i + 1).operationIndex() == s.operationIndex();
            frames.add(new LabTrace.Frame(s.operationIndex(), s.operation(), s.phase(),
                growing ? "The larger array is ready" : title(s.phase()), s.message(),
                growing ? "The current instruction continues after growing."
                    : "The highlighted slots changed in this step. Size changes when an instruction finishes.",
                s.sourceId(), view(s.slots(), s.size(), s.capacity(), s.oldSlots(), s.activeIndices())));
        }
        return new LabTrace(commands, frames);
    }
    private static Map<String,Object> view(List<Integer> slots,int size,int capacity,List<Integer> old,List<Integer> active) {
        List<Map<String,Object>> nodes = new ArrayList<>();
        for (int i = 0; i < slots.size(); i++) nodes.add(Map.of("id", "slot" + i,
            "label", slots.get(i) == null ? "·" : slots.get(i).toString(), "detail", "index " + i,
            "active", active.contains(i), "muted", slots.get(i) == null));
        List<Map<String,Object>> lanes = new ArrayList<>();
        if (old != null) lanes.add(Map.of("label", "Previous array", "items", old.stream().map(v -> v == null ? "·" : v.toString()).toList()));
        return Map.of("layout", "array", "nodes", nodes, "lanes", lanes,
            "summary", "Size " + size + " · Capacity " + capacity);
    }
    private static String title(String phase) {
        return switch (phase) {
            case "allocation" -> "Allocate a larger array"; case "copy" -> "Copy a value";
            case "shift" -> "Shift a value"; case "write" -> "Write a value";
            case "clear" -> "Clear the unused slot"; default -> "Finish the instruction";
        };
    }
    private static int integer(String text) {
        if (!text.matches("[+-]?[0-9]+")) throw new IllegalArgumentException("Use signed whole numbers.");
        try { return Integer.parseInt(text); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("Integer is outside Java's 32-bit range."); }
    }
    private static void length(String[] p,int expected) {
        if (p.length != expected) throw new IllegalArgumentException("Wrong number of arguments for " + p[0] + ".");
    }
}
