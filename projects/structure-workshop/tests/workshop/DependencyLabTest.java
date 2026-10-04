package workshop;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Random;

/** Dependency lab checks; run with assertions independent of JVM -ea settings. */
public final class DependencyLabTest {
    private static int assertions;

    private DependencyLabTest() { }

    public static void main(String[] args) {
        examples();
        cyclesAndEdits();
        invalidInputs();
        snapshots();
        randomGraphs();
        randomHeaps();
        System.out.println("DependencyLabTest: " + assertions + " assertions passed.");
    }

    private static void examples() {
        LabTrace chain = DependencyLab.run("sketch,cut,assemble,paint", "link sketch cut\nlink cut assemble\nlink assemble paint\norder");
        equal(output(last(chain)), List.of("sketch", "cut", "assemble", "paint"), "chain order");
        equal(last(chain).phase(), "complete", "chain complete");
        equal(chain.frames().get(0).operationIndex(), -1, "initial operation");
        equal(chain.frames().get(0).sourceId(), null, "initial source");
        equal(chain.frames().get(0).phase(), "initial", "initial frame");
        equal(output(last(DependencyLab.run("z,a,m", "order"))), List.of("a", "m", "z"), "disconnected order is lexical");
        equal(output(last(DependencyLab.run("x", "order"))), List.of("x"), "one node");
        equal(DependencyLab.run("a,b", "\n \n").frames().size(), 1, "blank instructions");
        LabTrace duplicate = DependencyLab.run("a,b", "link a b\nlink a b\norder");
        equal(output(last(duplicate)), List.of("a", "b"), "duplicate does not double indegrees");
        check(duplicate.frames().stream().anyMatch(frame -> frame.phase().equals("duplicate")), "duplicate is explained");
        for (LabTrace.Frame frame : chain.frames()) verifyPositions(frame);
    }

    private static void cyclesAndEdits() {
        LabTrace cycle = DependencyLab.run("a,b,c,d", "link a b\nlink b a\nlink b c\norder");
        equal(last(cycle).phase(), "blocked", "cycle blocks");
        equal(output(last(cycle)), List.of("d"), "independent task emitted before cycle blocks");
        check(last(cycle).message().contains("downstream"), "blocked description includes descendants");
        equal(lanes(last(cycle)).size(), 3, "descendant remains with cycle");
        LabTrace self = DependencyLab.run("a,b", "link a a\norder");
        equal(last(self).phase(), "blocked", "self loop blocks");
        equal(output(last(self)), List.of("b"), "self loop leaves independent task runnable");
        LabTrace edit = DependencyLab.run("a,b,c", "link c a\norder\nlink a b\norder\norder");
        equal(output(last(edit)), List.of("c", "a", "b"), "edit after ordering preserved");
        List<LabTrace.Frame> first = edit.frames().stream().filter(frame -> frame.operationIndex() == 3).toList();
        List<LabTrace.Frame> second = edit.frames().stream().filter(frame -> frame.operationIndex() == 4).toList();
        equal(first.size(), second.size(), "repeat frame count");
        for (int i = 0; i < first.size(); i++) {
            equal(first.get(i).view(), second.get(i).view(), "repeat snapshot");
            equal(first.get(i).phase(), second.get(i).phase(), "repeat phase");
        }
        LabTrace afterCycle = DependencyLab.run("a,b,c", "link a a\norder\nlink b c\norder");
        equal(output(last(afterCycle)), List.of("b", "c"), "edits after blocked ordering work");
    }

    private static void invalidInputs() {
        expect(IllegalArgumentException.class, () -> DependencyLab.run(null, "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", null));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("", "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a,", "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a,a", "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("0a", "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("longtasknameX", "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a b", "order"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", "link a b"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", "order extra"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", "delete a"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", "link a"));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", "order\n".repeat(25)));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a".repeat(513), ""));
        expect(IllegalArgumentException.class, () -> DependencyLab.run("a", " ".repeat(4097)));
        String twelve = "a,b,c,d,e,f,g,h,i,j,k,l";
        equal(output(last(DependencyLab.run(twelve, "order"))).size(), 12, "max task count accepted");
        expect(IllegalArgumentException.class, () -> DependencyLab.run(twelve + ",m", "order"));
        equal(DependencyLab.run("a", "order\n".repeat(24)).operations().size(), 24, "max command count accepted");
        equal(output(last(DependencyLab.run("a_b,z-2,A0", "order"))), List.of("A0", "a_b", "z-2"), "valid names and case sensitive order");
        StringBuilder links = new StringBuilder();
        String[] tasks = twelve.split(",");
        for (int i = 0; i < 24; i++) links.append("link ").append(tasks[i / 12]).append(' ').append(tasks[i % 12]).append('\n');
        equal(last(DependencyLab.run(twelve, links.toString())).view().get("summary"), "0 / 12 ordered · 24 dependencies", "max edge count accepted");
    }

    @SuppressWarnings("unchecked")
    private static void snapshots() {
        LabTrace trace = DependencyLab.run("a,b", "link b a\norder");
        LabTrace.Frame initial = trace.frames().get(0);
        equal(((List<?>) initial.view().get("edges")).size(), 0, "initial edges stay empty");
        equal(output(initial), List.of(), "initial output stays empty");
        expect(UnsupportedOperationException.class, () -> initial.view().put("x", "y"));
        expect(UnsupportedOperationException.class, () -> ((List<Object>) initial.view().get("nodes")).clear());
        Map<String, Object> node = ((List<Map<String, Object>>) initial.view().get("nodes")).get(0);
        expect(UnsupportedOperationException.class, () -> node.put("label", "changed"));
        expect(UnsupportedOperationException.class, () -> output(last(trace)).add("changed"));
        expect(UnsupportedOperationException.class, () -> trace.operations().add("order"));
        expect(UnsupportedOperationException.class, () -> trace.frames().clear());
        for (LabTrace.Frame frame : trace.frames()) verifyPositions(frame);
    }

    private static void randomGraphs() {
        Random random = new Random(4310L);
        for (int trial = 0; trial < 180; trial++) {
            int n = 2 + random.nextInt(11);
            String[] labels = new String[n];
            for (int i = 0; i < n; i++) labels[i] = "t" + i;
            List<Integer> permutation = new ArrayList<>();
            for (int i = 0; i < n; i++) permutation.add(i);
            java.util.Collections.shuffle(permutation, random);
            boolean[][] edges = new boolean[n][n];
            int count = 0;
            StringBuilder instructions = new StringBuilder();
            for (int i = 0; i < n; i++) {
                for (int j = i + 1; j < n; j++) {
                    if (count < 23 && random.nextBoolean()) {
                        int from = permutation.get(i);
                        int to = permutation.get(j);
                        edges[from][to] = true;
                        instructions.append("link ").append(labels[from]).append(' ').append(labels[to]).append('\n');
                        count++;
                    }
                }
            }
            instructions.append("order");
            LabTrace trace = DependencyLab.run(String.join(",", labels), instructions.toString());
            equal(last(trace).phase(), "complete", "random DAG completes");
            List<String> actual = output(last(trace));
            equal(actual, oracle(labels, edges), "random DAG matches independent lexical Kahn oracle");
            for (int from = 0; from < n; from++) {
                for (int to = 0; to < n; to++) {
                    if (edges[from][to]) check(actual.indexOf(labels[from]) < actual.indexOf(labels[to]), "every edge points forward");
                }
            }
            for (LabTrace.Frame frame : trace.frames()) verifyPositions(frame);
        }
    }

    private static List<String> oracle(String[] labels, boolean[][] edges) {
        List<String> output = new ArrayList<>();
        boolean[] done = new boolean[labels.length];
        while (output.size() < labels.length) {
            int best = -1;
            for (int candidate = 0; candidate < labels.length; candidate++) {
                if (done[candidate]) continue;
                boolean ready = true;
                for (int before = 0; before < labels.length; before++) if (edges[before][candidate] && !done[before]) ready = false;
                if (ready && (best < 0 || labels[candidate].compareTo(labels[best]) < 0)) best = candidate;
            }
            if (best < 0) break;
            done[best] = true;
            output.add(labels[best]);
        }
        return output;
    }

    private static void randomHeaps() {
        Random random = new Random(310L);
        for (int trial = 0; trial < 140; trial++) {
            int n = 1 + random.nextInt(12);
            String[] labels = new String[n];
            int[] keys = new int[n];
            for (int i = 0; i < n; i++) { labels[i] = "task" + i; keys[i] = random.nextInt(30); }
            DependencyLab.IndexedMinHeap heap = new DependencyLab.IndexedMinHeap(labels, keys, null);
            List<Integer> present = new ArrayList<>();
            for (int i = n - 1; i >= 0; i--) {
                heap.add(i);
                present.add(i);
                check(heap.invariantHolds(), "heap invariant after add");
            }
            expect(IllegalArgumentException.class, () -> heap.add(0));
            expect(IllegalArgumentException.class, () -> heap.decreaseKey(0, keys[0] + 1));
            expect(IllegalArgumentException.class, () -> heap.decreaseKey(0, -1));
            while (!present.isEmpty()) {
                int task = present.get(random.nextInt(present.size()));
                heap.decreaseKey(task, random.nextInt(keys[task] + 1));
                check(heap.invariantHolds(), "heap invariant after decrease key");
                int expected = present.stream().min(Comparator.<Integer>comparingInt(i -> keys[i]).thenComparing(i -> labels[i])).orElseThrow();
                equal(heap.peek(), expected, "heap root matches oracle");
                equal(heap.pop(), expected, "pop matches oracle");
                equal(heap.positionOf(expected), -1, "popped index cleared");
                present.remove(Integer.valueOf(expected));
                check(heap.invariantHolds(), "heap invariant after pop");
                expect(IllegalArgumentException.class, () -> heap.decreaseKey(expected, 0));
            }
            equal(heap.size(), 0, "drained heap");
            expect(IllegalStateException.class, heap::peek);
            expect(IllegalStateException.class, heap::pop);
            heap.add(0);
            check(heap.invariantHolds(), "reinsertion works");
            equal(heap.pop(), 0, "reinserted element");
            expect(IllegalArgumentException.class, () -> heap.add(-1));
            expect(IllegalArgumentException.class, () -> heap.positionOf(n));
        }
    }

    @SuppressWarnings("unchecked")
    private static void verifyPositions(LabTrace.Frame frame) {
        List<Map<String, Object>> tables = (List<Map<String, Object>>) frame.view().get("tables");
        List<List<String>> rows = (List<List<String>>) tables.get(0).get("rows");
        List<String> heap = lanes(frame);
        boolean[] seen = new boolean[heap.size()];
        for (List<String> row : rows) {
            if (!row.get(1).equals("—")) {
                int position = Integer.parseInt(row.get(1));
                check(position >= 0 && position < heap.size(), "snapshot heap position is in bounds");
                check(!seen[position], "snapshot heap position is unique");
                seen[position] = true;
                equal(heap.get(position), position + ": " + row.get(0) + " (" + row.get(2) + ")", "snapshot index maps back to task and key");
            }
        }
        for (boolean present : seen) check(present, "every heap position has an index entry");
    }

    @SuppressWarnings("unchecked")
    private static List<String> output(LabTrace.Frame frame) { return (List<String>) frame.view().get("output"); }

    @SuppressWarnings("unchecked")
    private static List<String> lanes(LabTrace.Frame frame) {
        return (List<String>) ((List<Map<String, Object>>) frame.view().get("lanes")).get(0).get("items");
    }

    private static LabTrace.Frame last(LabTrace trace) { return trace.frames().get(trace.frames().size() - 1); }
    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    private static void equal(Object actual, Object expected, String message) {
        check(java.util.Objects.equals(actual, expected), message + ": expected " + expected + ", got " + actual);
    }
    private static void expect(Class<? extends Throwable> type, Runnable action) {
        assertions++;
        try { action.run(); }
        catch (Throwable exception) {
            if (type.isInstance(exception)) return;
            throw new AssertionError("Expected " + type.getSimpleName() + ", got " + exception, exception);
        }
        throw new AssertionError("Expected " + type.getSimpleName());
    }
}
