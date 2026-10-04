package workshop;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/** Dependency-free tests of the real links, probing, and replay snapshots. */
public final class BranchLabTest {
    private static int assertions;

    public static void main(String[] args) {
        structureAndTraversal();
        collisionsWraparoundAndTombstones();
        boundedFullTableSearch();
        invalidOperationsAreAtomic();
        inputAndSizeLimits();
        immutableAndTruthfulFrames();
        randomizedOperations();
        System.out.println("BranchLab: " + assertions + " assertions passed.");
    }

    private static void structureAndTraversal() {
        BranchLab.State state = new BranchLab.State("grove");
        execute(state, "add grove fern", "add grove iris", "add fern moss", "add fern reed", "add iris oak");
        same("fern", state.root.firstChild.name, "root points to first child");
        same("iris", state.root.firstChild.nextSibling.name, "siblings preserve insertion order");
        same("moss", state.root.firstChild.firstChild.name, "child has its own child chain");
        execute(state, "preorder");
        same(List.of("grove", "fern", "moss", "reed", "iris", "oak"), state.output, "preorder");
        execute(state, "levelorder");
        same(List.of("grove", "fern", "iris", "moss", "reed", "oak"), state.output, "level order");
        same(List.of(), state.queueView, "queue empties");
        execute(state, "remove-leaf moss");
        same("reed", state.root.firstChild.firstChild.name, "remove first child bypasses to next sibling");
        execute(state, "remove-leaf oak", "remove-leaf iris");
        check(state.root.firstChild.nextSibling == null, "remove final sibling terminates chain");
        execute(state, "add grove lily", "add grove rose", "remove-leaf lily");
        same("rose", state.root.firstChild.nextSibling.name, "remove middle sibling reconnects chain");
        verifyLinksAndIndex(state);
        execute(state, "find fern");
        same(List.of("Found: fern"), state.output, "find hit");
        execute(state, "find missing");
        same(List.of("Not found: missing"), state.output, "find miss");
        execute(state, "add grove Fern");
        check(find(state, "Fern") != find(state, "fern"), "names are case-sensitive");
    }

    private static void collisionsWraparoundAndTombstones() {
        List<String> names = collidingNames(31, 5);
        BranchLab.State state = new BranchLab.State(names.get(0));
        execute(state, "add " + names.get(0) + " " + names.get(1), "add " + names.get(0) + " " + names.get(2));
        same(names.get(0), state.index[31].name, "home slot 31");
        same(names.get(1), state.index[0].name, "collision wraps to slot 0");
        same(names.get(2), state.index[1].name, "second collision advances to slot 1");
        execute(state, "remove-leaf " + names.get(1));
        check(state.index[0] == null && state.tombstones[0], "deletion leaves a tombstone");
        int before = state.frames.size();
        execute(state, "find " + names.get(2));
        same(List.of("Found: " + names.get(2)), state.output, "find searches beyond a tombstone");
        same(List.of("31", "0", "1"), probeSlots(state.frames.subList(before, state.frames.size())), "actual wrapped probe sequence");
        String signature = structure(state);
        fails(() -> execute(state, "add " + names.get(0) + " " + names.get(2)), "already exists");
        same(signature, structure(state), "duplicate beyond tombstone is not inserted");
        execute(state, "add " + names.get(0) + " " + names.get(3));
        same(names.get(3), state.index[0].name, "first tombstone is reused");
        check(!state.tombstones[0], "reused slot is not a tombstone");
        execute(state, "find " + names.get(4));
        same(List.of("Not found: " + names.get(4)), state.output, "colliding absent name terminates at empty slot");
        verifyLinksAndIndex(state);
    }

    private static void boundedFullTableSearch() {
        // A defensive internal test: public traces cap live nodes below table size.
        BranchLab.State state = new BranchLab.State("root");
        for (int i = 0; i < BranchLab.INDEX_CAPACITY; i++) {
            state.index[i] = null;
            state.tombstones[i] = true;
        }
        int before = state.frames.size();
        execute(state, "find absent");
        same(32L, state.frames.subList(before, state.frames.size()).stream().filter(f -> f.phase().equals("probe")).count(),
                "all-tombstone search has an explicit 32-probe bound");
        same(List.of("Not found: absent"), state.output, "all-tombstone search returns missing");
        state = new BranchLab.State("root");
        for (int i = 0; i < BranchLab.INDEX_CAPACITY; i++) state.index[i] = new BranchLab.Node("q" + i, null);
        before = state.frames.size();
        execute(state, "find absent");
        same(32L, state.frames.subList(before, state.frames.size()).stream().filter(f -> f.phase().equals("probe")).count(),
                "completely occupied table also terminates after 32 probes");
    }

    private static void invalidOperationsAreAtomic() {
        BranchLab.State state = new BranchLab.State("root");
        execute(state, "add root branch", "add branch leaf");
        String before = structure(state);
        for (String command : List.of("add root branch", "add missing fresh", "remove-leaf root", "remove-leaf branch", "remove-leaf missing")) {
            fails(() -> execute(state, command), null);
            same(before, structure(state), "invalid instruction preserves all links and index slots: " + command);
        }
        execute(state, "preorder");
        same(List.of("root", "branch", "leaf"), state.output, "valid operations still work after rejected edits");
        verifyLinksAndIndex(state);
    }

    private static void inputAndSizeLimits() {
        for (String name : List.of("", "9root", "a space", "a.b", "abcdefghijklmn", "á")) {
            fails(() -> BranchLab.run(name, ""), "Names must");
        }
        for (String command : List.of("drop root", "add root", "find", "find root extra", "preorder root", "add root 5bad")) {
            fails(() -> BranchLab.run("root", command), null);
        }
        LabTrace blank = BranchLab.run(" root ", "\n  \n");
        same(1, blank.frames().size(), "blank commands retain only initial frame");
        same(0, blank.operations().size(), "blank command list");
        LabTrace whitespace = BranchLab.run("root", "  add   root\tleaf \n preorder \n");
        same(List.of("add root leaf", "preorder"), whitespace.operations(), "command whitespace is normalized");
        same(List.of("root", "leaf"), last(whitespace).view().get("output"), "normalized commands execute");
        String twentyFour = "find root\n".repeat(24);
        same(24, BranchLab.run("root", twentyFour).operations().size(), "24 commands accepted");
        fails(() -> BranchLab.run("root", twentyFour + "find root"), "at most 24");
        BranchLab.State state = new BranchLab.State("root");
        for (int i = 0; i < 14; i++) execute(state, "add root n" + i);
        same(15, state.live, "15 live nodes accepted");
        String before = structure(state);
        fails(() -> execute(state, "add root overflow"), "15 live nodes");
        same(before, structure(state), "size-limit rejection is atomic");
        execute(state, "levelorder");
        same(15, state.output.size(), "bounded queue fits maximum tree");
        execute(state, "remove-leaf n0", "add root fresh");
        same(15, state.live, "removing a leaf makes room");
        verifyLinksAndIndex(state);
    }

    @SuppressWarnings("unchecked")
    private static void immutableAndTruthfulFrames() {
        LabTrace trace = BranchLab.run("root", "add root a\nadd root b\nremove-leaf a\nlevelorder");
        LabTrace.Frame initial = trace.frames().get(0);
        same(-1, initial.operationIndex(), "initial operation index");
        check(initial.sourceId() == null, "initial state has no executed source line");
        same(1, ((List<?>) initial.view().get("nodes")).size(), "initial snapshot was not changed by later edits");
        expectFrozen(() -> trace.operations().add("find root"));
        expectFrozen(() -> trace.frames().clear());
        expectFrozen(() -> initial.view().put("summary", "changed"));
        expectFrozen(() -> ((List<Object>) initial.view().get("nodes")).clear());
        Map<String, Object> firstNode = (Map<String, Object>) ((List<?>) initial.view().get("nodes")).get(0);
        expectFrozen(() -> firstNode.put("label", "changed"));
        for (LabTrace.Frame frame : trace.frames()) {
            if (frame != initial) check(frame.sourceId() != null && frame.sourceId().startsWith("branch."), "executed frame has source marker");
            List<Map<String, Object>> nodes = (List<Map<String, Object>>) frame.view().get("nodes");
            Set<String> ids = new HashSet<>();
            for (Map<String, Object> node : nodes) check(ids.add((String) node.get("id")), "each visual node appears once");
            for (Map<String, Object> edge : (List<Map<String, Object>>) frame.view().get("edges")) {
                check(ids.contains(edge.get("from")) && ids.contains(edge.get("to")), "every pointer endpoint exists in its frame");
                check(List.of("firstChild", "nextSibling").contains(edge.get("label")), "edges describe actual FCNS pointers");
            }
            if (frame.phase().equals("allocate") || frame.phase().equals("index") || frame.phase().equals("unlink")) {
                same(1L, nodes.stream().filter(n -> Boolean.TRUE.equals(n.get("muted"))).count(), "transient detached node is visibly staged");
            }
        }
        same(List.of("root", "b"), last(trace).view().get("output"), "final traversal excludes deleted node");
        LabTrace second = BranchLab.run("root", "add root a\nadd root b\nremove-leaf a\nlevelorder");
        same(trace, second, "same input yields identical replay");
    }

    private static void randomizedOperations() {
        Random random = new Random(310);
        for (int trial = 0; trial < 30; trial++) {
            BranchLab.State state = new BranchLab.State("root");
            Map<String, List<String>> children = new LinkedHashMap<>();
            children.put("root", new ArrayList<>());
            int nextName = 0;
            for (int step = 0; step < 24; step++) {
                List<String> names = new ArrayList<>(children.keySet());
                List<String> leaves = names.stream().filter(n -> !n.equals("root") && children.get(n).isEmpty()).toList();
                if (children.size() < 15 && (leaves.isEmpty() || random.nextBoolean())) {
                    String parent = names.get(random.nextInt(names.size()));
                    String child = "n" + nextName++;
                    execute(state, "add " + parent + " " + child);
                    children.get(parent).add(child);
                    children.put(child, new ArrayList<>());
                } else {
                    String leaf = leaves.get(random.nextInt(leaves.size()));
                    execute(state, "remove-leaf " + leaf);
                    children.remove(leaf);
                    for (List<String> siblings : children.values()) siblings.remove(leaf);
                }
                verifyLinksAndIndex(state);
                same(children.size(), state.live, "random live count agrees with independent model");
                execute(state, "preorder");
                List<String> expected = new ArrayList<>();
                modelPreorder("root", children, expected);
                same(expected, state.output, "random preorder agrees with independent model");
                execute(state, "levelorder");
                List<String> breadth = new ArrayList<>(List.of("root"));
                for (int i = 0; i < breadth.size(); i++) breadth.addAll(children.get(breadth.get(i)));
                same(breadth, state.output, "random level order agrees with independent model");
            }
        }
    }

    private static void modelPreorder(String name, Map<String, List<String>> children, List<String> result) {
        result.add(name);
        for (String child : children.get(name)) modelPreorder(child, children, result);
    }

    private static List<String> collidingNames(int home, int count) {
        List<String> names = new ArrayList<>();
        for (int i = 0; names.size() < count; i++) {
            String name = "n" + i;
            if (BranchLab.home(name) == home) names.add(name);
        }
        return names;
    }

    @SuppressWarnings("unchecked")
    private static List<String> probeSlots(List<LabTrace.Frame> frames) {
        List<String> result = new ArrayList<>();
        for (LabTrace.Frame frame : frames) {
            if (!frame.phase().equals("probe")) continue;
            Map<String, Object> table = ((List<Map<String, Object>>) frame.view().get("tables")).get(0);
            for (List<String> row : (List<List<String>>) table.get("rows")) {
                if (row.get(0).startsWith("→ ")) result.add(row.get(0).substring(2));
            }
        }
        return result;
    }

    private static void verifyLinksAndIndex(BranchLab.State state) {
        Set<BranchLab.Node> seen = new HashSet<>();
        verifySubtree(state.root, seen);
        same(state.live, seen.size(), "live count equals reachable nodes");
        int indexed = 0;
        for (int i = 0; i < state.index.length; i++) {
            BranchLab.Node node = state.index[i];
            if (node == null) continue;
            indexed++;
            check(!state.tombstones[i], "occupied slots are not tombstones");
            check(seen.contains(node), "every indexed node is reachable");
            int cursor = BranchLab.home(node.name);
            while (cursor != i) {
                check(state.index[cursor] != null || state.tombstones[cursor], "search chain has no empty gap");
                cursor = (cursor + 1) & 31;
            }
        }
        same(state.live, indexed, "each live node has one index entry");
        check(state.root.parent == null && state.root.nextSibling == null, "root has no parent or sibling");
    }

    private static void verifySubtree(BranchLab.Node node, Set<BranchLab.Node> seen) {
        check(seen.add(node), "tree has no repeated node or cycle");
        for (BranchLab.Node child = node.firstChild; child != null; child = child.nextSibling) {
            check(child.parent == node, "child retains correct parent");
            verifySubtree(child, seen);
        }
    }

    private static String structure(BranchLab.State state) {
        StringBuilder result = new StringBuilder().append(state.live).append(':');
        describe(state.root, result);
        for (int i = 0; i < state.index.length; i++) {
            result.append('|').append(i).append(':').append(state.index[i] == null ? "null" : state.index[i].name)
                    .append(':').append(state.tombstones[i]);
        }
        return result.toString();
    }

    private static void describe(BranchLab.Node node, StringBuilder result) {
        result.append(node.name).append('[');
        for (BranchLab.Node child = node.firstChild; child != null; child = child.nextSibling) describe(child, result);
        result.append(']');
    }

    private static BranchLab.Node find(BranchLab.State state, String name) {
        for (BranchLab.Node node : state.index) if (node != null && node.name.equals(name)) return node;
        return null;
    }

    private static void execute(BranchLab.State state, String... commands) {
        for (String command : commands) state.execute(command, 0);
    }

    private static LabTrace.Frame last(LabTrace trace) { return trace.frames().get(trace.frames().size() - 1); }

    private static void fails(Runnable action, String message) {
        try {
            action.run();
            throw new AssertionError("Expected an IllegalArgumentException.");
        } catch (IllegalArgumentException expected) {
            if (message != null) check(expected.getMessage().contains(message), "clear error message: " + expected.getMessage());
            else assertions++;
        }
    }

    private static void expectFrozen(Runnable action) {
        try {
            action.run();
            throw new AssertionError("Expected immutable trace metadata.");
        } catch (UnsupportedOperationException expected) { assertions++; }
    }

    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    private static void same(Object expected, Object actual, String message) {
        assertions++;
        if (!expected.equals(actual)) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
}
