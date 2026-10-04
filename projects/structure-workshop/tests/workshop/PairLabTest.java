package workshop;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Random;

public final class PairLabTest {
    private static int checks;

    public static void main(String[] args) {
        genericPairs();
        traceAssignments();
        emptySidesAndBounds();
        inputValidation();
        immutableSnapshots();
        randomizedPairs();
        System.out.println("PairLabTest: " + checks + " checks passed.");
    }

    private static void genericPairs() {
        PairLab.Pair<Integer> numbers = new PairLab.Pair<>(12, 27);
        numbers.swap();
        equal(numbers.left(), 27);
        equal(numbers.right(), 12);
        numbers.swap();
        equal(numbers.left(), 12);
        equal(numbers.right(), 27);
        numbers.setLeft(-9);
        numbers.setRight(0);
        equal(numbers.left(), -9);
        equal(numbers.right(), 0);
        numbers.clearLeft();
        numbers.clearRight();
        equal(numbers.left(), null);
        equal(numbers.right(), null);

        PairLab.Pair<String> words = new PairLab.Pair<>("fern", "moss");
        words.swap();
        equal(words.left(), "moss");
        equal(words.right(), "fern");
        words.clearRight();
        words.swap();
        equal(words.left(), null);
        equal(words.right(), "moss");
        words.setLeft("");
        words.setRight("ivy");
        equal(words.left(), "");
        equal(words.right(), "ivy");
    }

    private static void traceAssignments() {
        LabTrace trace = PairLab.run("12,27", "swap\nleft -3\nclear right\nswap\nright 0");
        equal(trace.operations(), List.of("swap", "left -3", "clear right", "swap", "right 0"));
        equal(trace.frames().size(), 10);
        LabTrace.Frame initial = trace.frames().get(0);
        equal(initial.operationIndex(), -1);
        equal(initial.sourceId(), null);
        equal(labels(initial), List.of("12", "27"));
        equal(labels(trace.frames().get(1)), List.of("12", "27", "12"));
        equal(labels(trace.frames().get(2)), List.of("27", "27", "12"));
        equal(labels(trace.frames().get(3)), List.of("27", "12"));
        equal(trace.frames().get(1).sourceId(), "pair.swap.temp");
        equal(trace.frames().get(2).sourceId(), "pair.swap.left");
        equal(trace.frames().get(3).sourceId(), "pair.swap.right");
        equal(labels(trace.frames().get(4)), List.of("-3", "12"));
        equal(labels(trace.frames().get(5)), List.of("-3", "empty"));
        equal(labels(trace.frames().get(6)), List.of("-3", "empty", "-3"));
        equal(labels(trace.frames().get(7)), List.of("empty", "empty", "-3"));
        equal(labels(trace.frames().get(8)), List.of("empty", "-3"));
        equal(labels(trace.frames().get(9)), List.of("empty", "0"));
        for (int i = 1; i < trace.frames().size(); i++) {
            LabTrace.Frame frame = trace.frames().get(i);
            equal(frame.operation(), trace.operations().get(frame.operationIndex()));
            truth(frame.sourceId().startsWith("pair."));
            truth(frame.note().contains("compile time"));
        }
    }

    private static void emptySidesAndBounds() {
        equal(lastLabels(PairLab.run("_,0", "swap")), List.of("0", "empty"));
        equal(lastLabels(PairLab.run("_,_", "swap")), List.of("empty", "empty"));
        equal(lastLabels(PairLab.run("-2147483648,2147483647", "swap")),
                List.of("2147483647", "-2147483648"));
        LabTrace noOperations = PairLab.run("0, _", "\n \t\n");
        equal(noOperations.frames().size(), 1);
        equal(noOperations.operations().size(), 0);
        equal(lastLabels(PairLab.run("+01,-02", " left\t+003\r\nright -004\n")), List.of("3", "-4"));
        equal(PairLab.run("1,2", "swap\n".repeat(24)).operations().size(), 24);
    }

    private static void inputValidation() {
        String[] badInitials = {"", "1", "1,2,3", ",2", "1,", "1.5,2", "one,2", "2147483648,0", "0,-2147483649", "null,0"};
        for (String value : badInitials) invalid(() -> PairLab.run(value, ""));
        String[] badInstructions = {"left", "left _", "left 1.5", "right 2147483648", "swap 1", "clear", "clear both", "clear left 1", "append 1", "Swap", "left 2\nright nope"};
        for (String value : badInstructions) invalid(() -> PairLab.run("1,2", value));
        invalid(() -> PairLab.run("1,2", "swap\n".repeat(25)));
        invalid(() -> PairLab.run(null, "swap"));
        invalid(() -> PairLab.run("1,2", null));
    }

    @SuppressWarnings("unchecked")
    private static void immutableSnapshots() {
        LabTrace trace = PairLab.run("12,27", "left 99\nswap");
        equal(labels(trace.frames().get(0)), List.of("12", "27"));
        unsupported(() -> trace.operations().add("swap"));
        unsupported(() -> trace.frames().clear());
        unsupported(() -> trace.frames().get(0).view().put("summary", "changed"));
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) trace.frames().get(0).view().get("nodes");
        unsupported(nodes::clear);
        unsupported(() -> nodes.get(0).put("label", "changed"));
        List<Map<String, Object>> lanes = (List<Map<String, Object>>) trace.frames().get(0).view().get("lanes");
        List<String> items = (List<String>) lanes.get(0).get("items");
        unsupported(() -> items.add("changed"));
    }

    private static void randomizedPairs() {
        Random random = new Random(3100);
        for (int trial = 0; trial < 150; trial++) {
            Integer left = random.nextInt();
            Integer right = random.nextInt();
            String initial = left + "," + right;
            StringBuilder instructions = new StringBuilder();
            for (int operation = 0; operation < 20; operation++) {
                switch (random.nextInt(5)) {
                    case 0 -> { left = random.nextInt(); instructions.append("left ").append(left).append('\n'); }
                    case 1 -> { right = random.nextInt(); instructions.append("right ").append(right).append('\n'); }
                    case 2 -> { Integer temp = left; left = right; right = temp; instructions.append("swap\n"); }
                    case 3 -> { left = null; instructions.append("clear left\n"); }
                    default -> { right = null; instructions.append("clear right\n"); }
                }
                equal(lastLabels(PairLab.run(initial, instructions.toString())), List.of(display(left), display(right)));
            }
        }
    }

    private static String display(Integer value) { return value == null ? "empty" : value.toString(); }

    private static List<String> lastLabels(LabTrace trace) {
        return labels(trace.frames().get(trace.frames().size() - 1));
    }

    @SuppressWarnings("unchecked")
    private static List<String> labels(LabTrace.Frame frame) {
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) frame.view().get("nodes");
        return nodes.stream().map(node -> (String) node.get("label")).toList();
    }

    private static void equal(Object actual, Object expected) {
        checks++;
        if (!Objects.equals(actual, expected)) throw new AssertionError("Expected " + expected + "; got " + actual);
    }

    private static void truth(boolean condition) {
        checks++;
        if (!condition) throw new AssertionError("Condition failed.");
    }

    private static void invalid(Runnable action) {
        checks++;
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid input to be rejected.");
    }

    private static void unsupported(Runnable action) {
        checks++;
        try { action.run(); } catch (UnsupportedOperationException expected) { return; }
        throw new AssertionError("Snapshot was mutable.");
    }
}
