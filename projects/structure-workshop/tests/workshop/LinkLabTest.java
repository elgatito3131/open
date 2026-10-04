package workshop;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/** Dependency-free invariant, boundary, undo, and trace checks; run with Java 17+. */
public final class LinkLabTest {
    private static int assertions;

    public static void main(String[] args) {
        construction();
        editsAndUndo();
        endpointsAndEmpty();
        lookupAndReusedId();
        rejectedEditsAreAtomic();
        boundaries();
        actualIntermediateLinks();
        snapshotsAreImmutable();
        deterministicReferenceModel();
        System.out.println("LinkLabTest: " + assertions + " assertions passed.");
    }

    private static void construction() {
        LinkLab.Engine empty = new LinkLab.Engine("");
        checkState(empty, List.of(), 0);
        equal(empty.headId(), "null");
        equal(empty.tailId(), "null");
        LinkLab.Engine list = new LinkLab.Engine(" fern, moss , reed ");
        checkState(list, List.of("fern", "moss", "reed"), 0);
        equal(list.headId(), "fern");
        equal(list.tailId(), "reed");
        equal(list.trace().frames().size(), 1);
        equal(list.trace().frames().get(0).operationIndex(), -1);
        equal(list.trace().frames().get(0).sourceId(), null);
        bad(() -> new LinkLab.Engine("fern,fern"));
        bad(() -> new LinkLab.Engine("fern,,reed"));
        bad(() -> new LinkLab.Engine("fern,"));
        bad(() -> new LinkLab.Engine("a b"));
        bad(() -> new LinkLab.Engine("12345678901234567"));
        bad(() -> new LinkLab.Engine(null));
        new LinkLab.Engine("UPPER_case-12345");
    }

    private static void editsAndUndo() {
        LinkLab.Engine list = new LinkLab.Engine("fern,moss,reed");
        list.apply("insert-after moss ivy");
        checkState(list, List.of("fern", "moss", "ivy", "reed"), 1);
        list.apply("remove moss");
        checkState(list, List.of("fern", "ivy", "reed"), 2);
        list.apply("prepend elm");
        checkState(list, List.of("elm", "fern", "ivy", "reed"), 3);
        list.apply("undo");
        checkState(list, List.of("fern", "ivy", "reed"), 2);
        list.apply("undo");
        checkState(list, List.of("fern", "moss", "ivy", "reed"), 1);
        list.apply("undo");
        checkState(list, List.of("fern", "moss", "reed"), 0);
        bad(() -> list.apply("undo"));
    }

    private static void endpointsAndEmpty() {
        LinkLab.Engine list = new LinkLab.Engine("a,b,c");
        list.apply("remove a");
        checkState(list, List.of("b", "c"), 1);
        equal(list.headId(), "b");
        list.apply("remove c");
        checkState(list, List.of("b"), 2);
        equal(list.tailId(), "b");
        list.apply("remove b");
        checkState(list, List.of(), 3);
        list.apply("undo");
        checkState(list, List.of("b"), 2);
        list.apply("undo");
        checkState(list, List.of("b", "c"), 1);
        list.apply("undo");
        checkState(list, List.of("a", "b", "c"), 0);
        LinkLab.Engine fresh = new LinkLab.Engine("");
        fresh.apply("prepend one");
        checkState(fresh, List.of("one"), 1);
        fresh.apply("insert-after one two");
        checkState(fresh, List.of("one", "two"), 2);
        fresh.apply("undo");
        checkState(fresh, List.of("one"), 1);
        fresh.apply("undo");
        checkState(fresh, List.of(), 0);
    }

    private static void lookupAndReusedId() {
        LinkLab.Engine list = new LinkLab.Engine("a,b,c");
        list.apply("remove b");
        list.apply("find b");
        checkState(list, List.of("a", "c"), 1);
        equal(last(list).view().get("output"), List.of("b: not found"));
        list.apply("insert-after c b");
        list.apply("find b");
        equal(last(list).view().get("output"), List.of("b: not found", "b: found (prev c, next null)"));
        checkState(list, List.of("a", "c", "b"), 2);
        list.apply("undo");
        checkState(list, List.of("a", "c"), 1);
        list.apply("undo");
        checkState(list, List.of("a", "b", "c"), 0);
        list.apply("find b");
        checkState(list, List.of("a", "b", "c"), 0);
    }

    private static void rejectedEditsAreAtomic() {
        LinkLab.Engine list = new LinkLab.Engine("a,b,c");
        for (String instruction : List.of("insert-after missing fresh", "insert-after a b", "prepend a", "remove missing", "undo", "insert-after a", "remove a b", "undo a", "find", "spin a", "prepend <>")) {
            LabTrace before = list.trace();
            bad(() -> list.apply(instruction));
            equal(list.trace(), before);
            checkState(list, List.of("a", "b", "c"), 0);
        }
        LabTrace before = list.trace();
        bad(() -> list.apply(null));
        bad(() -> list.apply("   "));
        equal(list.trace(), before);
        bad(() -> LinkLab.run("", null));
        bad(() -> LinkLab.run("", " ".repeat(4097)));
    }

    private static void boundaries() {
        String initial = "a,b,c,d,e,f,g,h,i,j";
        bad(() -> new LinkLab.Engine(initial + ",k"));
        LinkLab.Engine full = new LinkLab.Engine(initial);
        for (int i = 0; i < 6; i++) full.apply("prepend n" + i);
        equal(full.lookupSize(), 16);
        LabTrace before = full.trace();
        bad(() -> full.apply("prepend overflow"));
        equal(full.trace(), before);
        full.apply("remove a");
        equal(full.lookupSize(), 15);
        full.apply("undo");
        equal(full.lookupSize(), 16);
        check(full.consistent(), "Boundary undo preserves links.");
        LinkLab.Engine commands = new LinkLab.Engine("");
        for (int i = 0; i < 24; i++) commands.apply("find absent");
        equal(commands.trace().operations().size(), 24);
        bad(() -> commands.apply("find absent"));
        bad(() -> LinkLab.run("", "find absent\n".repeat(25)));
        equal(LinkLab.run("", "\n\n").frames().size(), 1);
        equal(LinkLab.run("a", "  find   a  \n\n").operations(), List.of("find a"));
        check(full.trace().frames().size() < LinkLab.MAX_FRAMES, "Frame budget is bounded.");
    }

    private static void actualIntermediateLinks() {
        LabTrace insert = LinkLab.run("fern,moss,reed", "insert-after moss ivy");
        LabTrace.Frame partial = frame(insert, "link.attach.left");
        check(edge(partial, "moss", "ivy", "next"), "Left next changes first.");
        check(edge(partial, "reed", "moss", "prev"), "Right previous still reflects its old value.");
        check(!edge(partial, "reed", "ivy", "prev"), "The snapshot does not anticipate a future pointer write.");
        LabTrace.Frame committed = insert.frames().get(insert.frames().size() - 1);
        check(edge(committed, "reed", "ivy", "prev"), "Committed next/prev agree.");
        equal(nodes(committed).stream().map(node -> node.get("id")).toList(), List.of("fern", "moss", "ivy", "reed"));
        LabTrace remove = LinkLab.run("a,b,c", "remove b");
        LabTrace.Frame bypass = frame(remove, "link.detach.left");
        check(edge(bypass, "a", "c", "next"), "Removal changes the actual forward link.");
        check(edge(bypass, "c", "b", "prev"), "The old backward link is retained until changed.");
        check(nodes(frame(remove, "link.detach.index")).stream().anyMatch(node -> node.get("id").equals("b") && node.get("muted").equals(true)), "A removed transient node remains visible and unindexed.");
        for (LabTrace trace : List.of(insert, remove, LinkLab.run("", "prepend a\nremove a\nundo\nundo"))) {
            for (LabTrace.Frame current : trace.frames()) {
                Set<Object> ids = new HashSet<>();
                for (Map<String, Object> node : nodes(current)) check(ids.add(node.get("id")), "Visible node IDs are unique.");
                for (Map<String, Object> link : maps(current.view().get("edges"))) {
                    check(ids.contains(link.get("from")) && ids.contains(link.get("to")), "Every actual pointer endpoint is rendered.");
                }
                if (current.operationIndex() >= 0) check(current.sourceId() != null && current.sourceId().startsWith("link."), "Every execution frame has a source marker.");
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static void snapshotsAreImmutable() {
        LinkLab.Engine list = new LinkLab.Engine("a,b");
        LabTrace before = list.trace();
        String initialSnapshot = before.frames().get(0).view().toString();
        list.apply("insert-after a c");
        list.apply("remove a");
        equal(before.frames().size(), 1);
        equal(before.operations().size(), 0);
        equal(before.frames().get(0).view().toString(), initialSnapshot);
        frozen(() -> before.frames().clear());
        frozen(() -> before.operations().add("find a"));
        Map<String, Object> view = before.frames().get(0).view();
        frozen(() -> view.put("summary", "changed"));
        frozen(() -> ((List<Object>) view.get("nodes")).clear());
        frozen(() -> nodes(before.frames().get(0)).get(0).put("id", "changed"));
        List<Map<String, Object>> tables = maps(view.get("tables"));
        frozen(() -> ((List<List<String>>) tables.get(0).get("rows")).get(0).add("changed"));
    }

    private static void deterministicReferenceModel() {
        Random random = new Random(310_2026L);
        for (int trial = 0; trial < 200; trial++) {
            LinkLab.Engine actual = new LinkLab.Engine("a,b,c");
            List<String> expected = new ArrayList<>(List.of("a", "b", "c"));
            Deque<List<String>> history = new ArrayDeque<>();
            int serial = 0;
            for (int step = 0; step < 24; step++) {
                int choice = random.nextInt(5);
                if (choice == 0 && !history.isEmpty()) {
                    actual.apply("undo");
                    expected = history.pop();
                } else if (choice == 1 && !expected.isEmpty()) {
                    history.push(new ArrayList<>(expected));
                    int index = random.nextInt(expected.size());
                    actual.apply("remove " + expected.remove(index));
                } else if (choice == 2 || expected.size() == LinkLab.MAX_LIVE) {
                    String id = expected.isEmpty() || random.nextBoolean() ? "absent" : expected.get(random.nextInt(expected.size()));
                    actual.apply("find " + id);
                } else {
                    history.push(new ArrayList<>(expected));
                    String id = "n" + serial++;
                    if (expected.isEmpty() || choice == 3) {
                        actual.apply("prepend " + id);
                        expected.add(0, id);
                    } else {
                        int index = random.nextInt(expected.size());
                        actual.apply("insert-after " + expected.get(index) + " " + id);
                        expected.add(index + 1, id);
                    }
                }
                checkState(actual, expected, history.size());
                equal(nodes(last(actual)).stream().map(node -> node.get("id")).toList(), expected);
                check(actual.trace().frames().size() <= LinkLab.MAX_FRAMES, "Random trace respects its frame limit.");
            }
        }
    }

    private static void checkState(LinkLab.Engine engine, List<String> order, int history) {
        check(engine.consistent(), "Head, tail, reciprocal links, and lookup index agree.");
        equal(engine.order(), order);
        equal(engine.lookupSize(), order.size());
        equal(engine.historySize(), history);
        equal(engine.headId(), order.isEmpty() ? "null" : order.get(0));
        equal(engine.tailId(), order.isEmpty() ? "null" : order.get(order.size() - 1));
    }
    private static LabTrace.Frame last(LinkLab.Engine engine) { List<LabTrace.Frame> frames = engine.trace().frames(); return frames.get(frames.size() - 1); }
    private static LabTrace.Frame frame(LabTrace trace, String source) { return trace.frames().stream().filter(frame -> source.equals(frame.sourceId())).findFirst().orElseThrow(); }
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object value) { return (List<Map<String, Object>>) value; }
    private static List<Map<String, Object>> nodes(LabTrace.Frame frame) { return maps(frame.view().get("nodes")); }
    private static boolean edge(LabTrace.Frame frame, String from, String to, String label) {
        return maps(frame.view().get("edges")).stream().anyMatch(edge -> from.equals(edge.get("from")) && to.equals(edge.get("to")) && label.equals(edge.get("label")));
    }
    private static void equal(Object actual, Object expected) { check(java.util.Objects.equals(actual, expected), "Expected " + expected + ", got " + actual); }
    private static void check(boolean passed, String message) { assertions++; if (!passed) throw new AssertionError(message); }
    private static void bad(Runnable operation) {
        assertions++;
        try { operation.run(); } catch (IllegalArgumentException expected) { if (expected.getMessage().isBlank()) throw new AssertionError("Explain rejected input."); return; }
        throw new AssertionError("Expected IllegalArgumentException.");
    }
    private static void frozen(Runnable operation) {
        assertions++;
        try { operation.run(); } catch (UnsupportedOperationException expected) { return; }
        throw new AssertionError("Snapshot should be immutable.");
    }
}
