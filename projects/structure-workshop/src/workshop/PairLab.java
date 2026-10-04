package workshop;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** A small generic pair, with snapshots of the assignments it actually performs. */
public final class PairLab {
    private static final int MAX_OPERATIONS = 24;
    private static final String TYPE_NOTE = "Java checks Pair<Integer> at compile time. Parsing an input as an integer is a separate runtime check.";

    private PairLab() {}

    /** Null means an empty side. Both occupied sides have the same declared type T. */
    public static final class Pair<T> {
        private T left;
        private T right;
        private final Consumer<Step<T>> observer;

        public Pair(T left, T right) {
            this(left, right, step -> {});
        }

        private Pair(T left, T right, Consumer<Step<T>> observer) {
            this.left = left;
            this.right = right;
            this.observer = observer;
        }

        public T left() { return left; }
        public T right() { return right; }

        public void setLeft(T value) {
            left = value; // @source pair.left
            emit("write", "Replace the left value", "Left now refers to the supplied value.", "pair.left", null, false, "left");
        }

        public void setRight(T value) {
            right = value; // @source pair.right
            emit("write", "Replace the right value", "Right now refers to the supplied value.", "pair.right", null, false, "right");
        }

        public void clearLeft() {
            left = null; // @source pair.clear.left
            emit("clear", "Clear the left side", "Left is empty. Empty is different from the integer zero.", "pair.clear.left", null, false, "left");
        }

        public void clearRight() {
            right = null; // @source pair.clear.right
            emit("clear", "Clear the right side", "Right is empty. The other side keeps its value.", "pair.clear.right", null, false, "right");
        }

        public void swap() {
            T temp = left; // @source pair.swap.temp
            emit("save", "Save the original left value", "The temporary reference preserves left before either side changes.", "pair.swap.temp", temp, true, "left", "temp");
            left = right; // @source pair.swap.left
            emit("write", "Move right into left", "Both sides now refer to the original right value. The temporary reference still holds the original left value.", "pair.swap.left", temp, true, "left", "right");
            right = temp; // @source pair.swap.right
            emit("commit", "Finish the swap", "Right receives the saved original left value. The swap is complete, so the local temporary reference leaves the picture.", "pair.swap.right", null, false, "right");
        }

        private void emit(String phase, String title, String message, String sourceId,
                T temp, boolean showTemp, String... active) {
            observer.accept(new Step<>(left, right, temp, showTemp, List.of(active), phase, title, message, sourceId));
        }
    }

    private record Step<T>(T left, T right, T temp, boolean showTemp, List<String> active,
            String phase, String title, String message, String sourceId) {}

    private record Command(String text, String verb, Integer value, String side) {}

    /** Initial values are two comma-separated integers; an underscore means empty. */
    public static LabTrace run(String initial, String instructions) {
        if (initial == null || instructions == null) {
            throw new IllegalArgumentException("Provide initial values and instructions.");
        }
        String[] values = initial.split(",", -1);
        if (values.length != 2) {
            throw new IllegalArgumentException("Enter exactly two initial values, such as 12, 27. Use _ for an empty side.");
        }
        Integer left = initialValue(values[0].trim());
        Integer right = initialValue(values[1].trim());
        List<Command> commands = parseCommands(instructions);
        List<String> operations = commands.stream().map(Command::text).toList();
        List<LabTrace.Frame> frames = new ArrayList<>();
        frames.add(new LabTrace.Frame(-1, "Initial values", "initial", "A pair of typed values",
                "Each side stores an Integer reference. An empty side contains null; values are displayed rather than memory addresses.",
                TYPE_NOTE, null, view(left, right, null, false, List.of(), "The pair is ready.")));
        int[] current = {-1};
        Pair<Integer> pair = new Pair<>(left, right, step -> frames.add(new LabTrace.Frame(
                current[0], operations.get(current[0]), step.phase(), step.title(), step.message(), TYPE_NOTE,
                step.sourceId(), view(step.left(), step.right(), step.temp(), step.showTemp(), step.active(), step.title()))));
        for (int i = 0; i < commands.size(); i++) {
            current[0] = i;
            Command command = commands.get(i);
            switch (command.verb()) {
                case "left" -> pair.setLeft(command.value());
                case "right" -> pair.setRight(command.value());
                case "swap" -> pair.swap();
                case "clear" -> {
                    if (command.side().equals("left")) pair.clearLeft();
                    else pair.clearRight();
                }
                default -> throw new AssertionError("Validated command was not handled.");
            }
        }
        return new LabTrace(operations, frames);
    }

    private static Integer initialValue(String value) {
        return value.equals("_") ? null : integer(value);
    }

    private static int integer(String value) {
        if (!value.matches("[+-]?[0-9]+")) {
            throw new IllegalArgumentException("Expected an integer from -2147483648 to 2147483647; use _ only in initial values.");
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Integer is outside the range -2147483648 to 2147483647.");
        }
    }

    private static List<Command> parseCommands(String instructions) {
        List<Command> commands = new ArrayList<>();
        for (String line : instructions.split("\\R")) {
            String text = line.trim();
            if (text.isEmpty()) continue;
            if (commands.size() == MAX_OPERATIONS) {
                throw new IllegalArgumentException("Use at most 24 instructions.");
            }
            String[] parts = text.split("\\s+");
            String verb = parts[0];
            if ((verb.equals("left") || verb.equals("right")) && parts.length == 2) {
                int value = integer(parts[1]);
                commands.add(new Command(verb + " " + value, verb, value, ""));
            } else if (verb.equals("swap") && parts.length == 1) {
                commands.add(new Command("swap", "swap", null, ""));
            } else if (verb.equals("clear") && parts.length == 2
                    && (parts[1].equals("left") || parts[1].equals("right"))) {
                commands.add(new Command("clear " + parts[1], "clear", null, parts[1]));
            } else {
                throw new IllegalArgumentException("Use left INT, right INT, swap, clear left, or clear right (instruction " + (commands.size() + 1) + ").");
            }
        }
        return commands;
    }

    private static Map<String, Object> view(Integer left, Integer right, Integer temp,
            boolean showTemp, List<String> active, String summary) {
        List<Map<String, Object>> nodes = new ArrayList<>();
        nodes.add(node("left", left, active));
        nodes.add(node("right", right, active));
        if (showTemp) nodes.add(node("temp", temp, active));
        return Map.of("layout", "pair", "nodes", nodes, "edges", List.of(),
                "lanes", List.of(Map.of("label", "Declared type", "items", List.of("Pair<Integer>", "T = Integer"))),
                "summary", summary, "output", List.of("Left: " + display(left), "Right: " + display(right)));
    }

    private static Map<String, Object> node(String id, Integer value, List<String> active) {
        return Map.of("id", id, "label", display(value), "detail", id.equals("temp") ? "temporary reference" : id,
                "active", active.contains(id), "muted", value == null);
    }

    private static String display(Integer value) {
        return value == null ? "empty" : value.toString();
    }
}
