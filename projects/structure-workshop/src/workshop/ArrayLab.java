package workshop;

import observatory.DynamicBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Connects text instructions and visual frames to the shared dynamic-array engine. */
public final class ArrayLab {
    private ArrayLab() {}

    public static LabTrace run(String initial, String instructions) {
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(initialValues(initial), DynamicBuffer.Growth.DOUBLE);
        List<String> commands = instructionLines(instructions);
        LabTrace.Frame startingFrame = initialFrame(buffer);
        execute(buffer, commands);
        return buildTrace(commands, startingFrame, buffer.steps());
    }

    private static List<Integer> initialValues(String initial) {
        List<Integer> values = new ArrayList<>();
        if (!initial.isBlank()) {
            for (String token : initial.split(",", -1)) values.add(parseInteger(token.strip()));
        }
        if (values.size() > 16) throw new IllegalArgumentException("Use at most 16 initial values.");
        return values;
    }

    private static List<String> instructionLines(String instructions) {
        List<String> commands = instructions.lines().map(String::strip).filter(s -> !s.isEmpty()).toList();
        if (commands.size() > 24) throw new IllegalArgumentException("Use at most 24 instructions.");
        return commands;
    }

    private static LabTrace.Frame initialFrame(DynamicBuffer<Integer> buffer) {
        DynamicBuffer.Snapshot<Integer> snapshot = buffer.snapshot();
        return new LabTrace.Frame(-1, "", "initial", "Before the first instruction",
            "The initial values are stored in the Java array.", "Size counts values; capacity counts all slots.", null,
            view(snapshot.slots(), snapshot.size(), snapshot.capacity(), null, List.of()));
    }

    private static void execute(DynamicBuffer<Integer> buffer, List<String> commands) {
        for (int i = 0; i < commands.size(); i++) {
            try {
                applyInstruction(buffer, commands.get(i));
            } catch (IllegalArgumentException | IndexOutOfBoundsException | IllegalStateException error) {
                throw new IllegalArgumentException("Instruction " + (i + 1) + ": " + error.getMessage());
            }
        }
    }

    private static void applyInstruction(DynamicBuffer<Integer> buffer, String instruction) {
        String[] arguments = instruction.split("\\s+");
        switch (arguments[0]) {
            case "append" -> {
                requireArgumentCount(arguments, 2);
                buffer.append(parseInteger(arguments[1]));
            }
            case "insert" -> {
                requireArgumentCount(arguments, 3);
                buffer.insert(parseInteger(arguments[1]), parseInteger(arguments[2]));
            }
            case "remove" -> {
                requireArgumentCount(arguments, 2);
                buffer.remove(parseInteger(arguments[1]));
            }
            case "set" -> {
                requireArgumentCount(arguments, 3);
                buffer.set(parseInteger(arguments[1]), parseInteger(arguments[2]));
            }
            default -> throw new IllegalArgumentException("Use append, insert, remove, or set.");
        }
    }

    private static LabTrace buildTrace(List<String> commands, LabTrace.Frame startingFrame,
            List<DynamicBuffer.Step<Integer>> steps) {
        List<LabTrace.Frame> frames = new ArrayList<>(steps.size() + 1);
        frames.add(startingFrame);
        for (int i = 0; i < steps.size(); i++) frames.add(frameAt(steps, i));
        return new LabTrace(commands, frames);
    }

    private static LabTrace.Frame frameAt(List<DynamicBuffer.Step<Integer>> steps, int index) {
        DynamicBuffer.Step<Integer> step = steps.get(index);
        // A resize commits its new storage before the enclosing edit finishes.
        boolean growthCompleted = step.phase().equals("commit") && index + 1 < steps.size()
            && steps.get(index + 1).operationIndex() == step.operationIndex();
        return new LabTrace.Frame(step.operationIndex(), step.operation(), step.phase(),
            growthCompleted ? "The larger array is ready" : title(step.phase()), step.message(),
            growthCompleted ? "The current instruction continues after growing."
                : "The highlighted slots changed in this step. Size changes when an instruction finishes.",
            step.sourceId(), view(step.slots(), step.size(), step.capacity(), step.oldSlots(), step.activeIndices()));
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
    private static int parseInteger(String text) {
        if (!text.matches("[+-]?[0-9]+")) throw new IllegalArgumentException("Use signed whole numbers.");
        try { return Integer.parseInt(text); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("Integer is outside Java's 32-bit range."); }
    }
    private static void requireArgumentCount(String[] arguments, int expected) {
        if (arguments.length != expected) {
            throw new IllegalArgumentException("Wrong number of arguments for " + arguments[0] + ".");
        }
    }
}
