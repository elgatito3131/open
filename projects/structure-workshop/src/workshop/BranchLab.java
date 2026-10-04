package workshop;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** A small ordered tree, stored with first-child / next-sibling pointers. */
public final class BranchLab {
    static final int INDEX_CAPACITY = 32;
    static final int MAX_NODES = 15;
    private static final int MAX_COMMANDS = 24;
    private static final Pattern NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,11}");

    private BranchLab() { }

    public static LabTrace run(String initial, String instructions) {
        String rootName = initial == null ? "" : initial.trim();
        requireName(rootName);
        List<String> operations = new ArrayList<>();
        for (String raw : (instructions == null ? "" : instructions).split("\\R")) {
            String command = raw.trim().replaceAll("\\s+", " ");
            if (command.isEmpty()) continue;
            validate(command);
            operations.add(command);
        }
        if (operations.size() > MAX_COMMANDS) {
            throw new IllegalArgumentException("Use at most 24 instructions per trace.");
        }
        State state = new State(rootName);
        for (int i = 0; i < operations.size(); i++) state.execute(operations.get(i), i);
        return new LabTrace(operations, state.frames);
    }

    private static void requireName(String name) {
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("Names must start with a letter and contain 1–12 letters, digits, underscores, or hyphens.");
        }
    }

    private static void validate(String command) {
        String[] words = command.split(" ");
        int length = switch (words[0]) {
            case "add" -> 3;
            case "find", "remove-leaf" -> 2;
            case "preorder", "levelorder" -> 1;
            default -> throw new IllegalArgumentException("Unknown instruction: " + words[0]
                    + ". Use add PARENT CHILD, find NAME, remove-leaf NAME, preorder, or levelorder.");
        };
        if (words.length != length) throw new IllegalArgumentException("Wrong number of arguments: " + command);
        for (int i = 1; i < words.length; i++) requireName(words[i]);
    }

    /** Small polynomial hash; every lookup below is bounded by the table size. */
    static int home(String name) {
        int hash = 0;
        for (int i = 0; i < name.length(); i++) hash = (hash * 31 + name.charAt(i)) & 31;
        return hash;
    }

    static final class Node {
        final String name;
        final Node parent;
        Node firstChild;
        Node nextSibling;

        Node(String name, Node parent) {
            this.name = name;
            this.parent = parent;
        }
    }

    private record Search(Node node, int slot) { }

    /** Package-visible to let the tests check failed-operation atomicity. */
    static final class State {
        final Node root;
        final Node[] index = new Node[INDEX_CAPACITY];
        final boolean[] tombstones = new boolean[INDEX_CAPACITY];
        final List<LabTrace.Frame> frames = new ArrayList<>();
        final List<String> output = new ArrayList<>();
        final List<String> queueView = new ArrayList<>();
        int live = 1;
        int operationIndex = -1;
        String operation = "Initial tree";
        String activeName;
        int activeSlot = -1;
        Node staged;
        String stageNote = "";

        State(String rootName) {
            requireName(rootName);
            root = new Node(rootName, null);
            index[home(rootName)] = root;
            emit("initial", "One root, no children", "The root is stored in the name index.",
                    "The tree uses first-child and next-sibling links. The index has 32 fixed slots.", null);
        }

        void execute(String command, int number) {
            validate(command);
            operation = command;
            operationIndex = number;
            activeName = null;
            activeSlot = -1;
            output.clear();
            queueView.clear();
            String[] words = command.split(" ");
            switch (words[0]) {
                case "add" -> add(words[1], words[2]);
                case "find" -> find(words[1]);
                case "remove-leaf" -> removeLeaf(words[1]);
                case "preorder" -> preorder(root);
                case "levelorder" -> levelorder();
                default -> throw new AssertionError("Validated command was not handled.");
            }
        }

        private Search lookup(String name) {
            int start = home(name);
            int firstTombstone = -1;
            for (int offset = 0; offset < INDEX_CAPACITY; offset++) {
                int slot = (start + offset) & (INDEX_CAPACITY - 1);
                Node candidate = index[slot]; // @source branch.probe
                activeSlot = slot;
                activeName = candidate == null ? null : candidate.name;
                String state = candidate != null ? "contains " + candidate.name
                        : tombstones[slot] ? "is a tombstone" : "is empty";
                emit("probe", "Probe slot " + slot, "Looking for " + name + ": slot " + slot + " " + state + ".",
                        "Home slot " + start + "; probe " + (offset + 1) + " of at most 32. "
                        + (tombstones[slot] ? "A tombstone does not end a search." : "Probes wrap from slot 31 to slot 0."),
                        "branch.probe");
                if (candidate != null && candidate.name.equals(name)) return new Search(candidate, slot);
                if (candidate == null && tombstones[slot] && firstTombstone < 0) firstTombstone = slot;
                if (candidate == null && !tombstones[slot]) {
                    return new Search(null, firstTombstone >= 0 ? firstTombstone : slot);
                }
            }
            return new Search(null, firstTombstone);
        }

        private void add(String parentName, String childName) {
            // Complete all failure checks before changing any tree pointer or index slot.
            if (live == MAX_NODES) throw new IllegalArgumentException("The visual tree is limited to 15 live nodes.");
            Node parent = lookup(parentName).node();
            if (parent == null) throw new IllegalArgumentException("Parent not found: " + parentName);
            Search place = lookup(childName);
            if (place.node() != null) throw new IllegalArgumentException("A node named " + childName + " already exists.");
            if (place.slot() < 0) throw new IllegalArgumentException("The name index has no reusable slot.");

            Node child = new Node(childName, parent); // @source branch.allocate
            staged = child;
            stageNote = "allocated; not indexed or linked";
            activeName = child.name;
            activeSlot = -1;
            emit("allocate", "Allocate " + childName, "Create one node with empty child and sibling links.",
                    "The faded node is staged. It is not part of the tree yet.", "branch.allocate");

            index[place.slot()] = child; // @source branch.index-store
            tombstones[place.slot()] = false;
            activeSlot = place.slot();
            stageNote = "indexed; not linked to the tree";
            emit("index", "Index the new name", childName + " is stored at slot " + place.slot() + ".",
                    "The index may reuse the first tombstone encountered during the complete name search.", "branch.index-store");

            if (parent.firstChild == null) {
                parent.firstChild = child; // @source branch.attach-first
                staged = null;
                live++;
                emit("link", "Attach the first child", parentName + ".firstChild now points to " + childName + ".",
                        "The child is now reachable from the root; the live-node count increases.", "branch.attach-first");
            } else {
                Node tail = parent.firstChild; // @source branch.tail-first
                activeName = tail.name;
                emit("walk", "Start at the first child", "Find the end of " + parentName + "'s child chain.",
                        "Children form a sibling chain, so appending a child may require walking that chain.", "branch.tail-first");
                while (tail.nextSibling != null) {
                    tail = tail.nextSibling; // @source branch.tail-next
                    activeName = tail.name;
                    emit("walk", "Follow nextSibling", "The next sibling is " + tail.name + ".",
                            "The new child remains staged until the final pointer is connected.", "branch.tail-next");
                }
                tail.nextSibling = child; // @source branch.attach-sibling
                staged = null;
                live++;
                activeName = child.name;
                emit("link", "Attach the last sibling", tail.name + ".nextSibling now points to " + childName + ".",
                        "The parent still points only to its first child; siblings keep their insertion order.", "branch.attach-sibling");
            }
        }

        private void find(String name) {
            Search result = lookup(name); // @source branch.find
            activeName = result.node() == null ? null : result.node().name;
            if (result.node() != null) activeSlot = result.slot();
            output.add(result.node() == null ? "Not found: " + name : "Found: " + name);
            emit("result", result.node() == null ? "Name not found" : "Name found", output.get(0) + ".",
                    "Looking up a name changes neither the tree nor the index.", "branch.find");
        }

        private void removeLeaf(String name) {
            Search found = lookup(name);
            Node node = found.node();
            if (node == null) throw new IllegalArgumentException("Node not found: " + name);
            if (node == root) throw new IllegalArgumentException("The root cannot be removed.");
            if (node.firstChild != null) throw new IllegalArgumentException(name + " has children. Only leaves can be removed.");
            Node parent = node.parent;
            Node previous = null;
            for (Node cursor = parent.firstChild; cursor != node; cursor = cursor.nextSibling) {
                previous = cursor; // @source branch.predecessor
                activeName = cursor.name;
                emit("walk", "Find the preceding sibling", "Walk past " + cursor.name + " on the way to " + name + ".",
                        "Removing a sibling requires reconnecting the pointer that currently reaches it.", "branch.predecessor");
            }
            staged = node;
            stageNote = "unlinked; old index entry still present";
            if (previous == null) {
                parent.firstChild = node.nextSibling; // @source branch.detach-first
                live--;
                activeName = parent.name;
                emit("unlink", "Bypass the first child", parent.name + ".firstChild now points to " + nameOf(parent.firstChild) + ".",
                        "The removed node is no longer reachable from the root. Its index entry is cleared next.", "branch.detach-first");
            } else {
                previous.nextSibling = node.nextSibling; // @source branch.detach-sibling
                live--;
                activeName = previous.name;
                emit("unlink", "Bypass the removed sibling", previous.name + ".nextSibling now points to " + nameOf(previous.nextSibling) + ".",
                        "The faded node is detached. Its saved nextSibling link still reflects its old position.", "branch.detach-sibling");
            }
            index[found.slot()] = null; // @source branch.index-delete
            tombstones[found.slot()] = true;
            activeSlot = found.slot();
            activeName = null;
            staged = null;
            output.add("Removed: " + name);
            emit("delete", "Leave a tombstone", "Clear slot " + found.slot() + " and mark it as previously occupied.",
                    "Making this slot simply empty could hide colliding names farther along the probe chain.", "branch.index-delete");
        }

        private void preorder(Node node) {
            output.add(node.name); // @source branch.preorder
            activeName = node.name;
            activeSlot = -1;
            emit("visit", "Visit " + node.name, "Preorder visits a node before its children.",
                    "Follow firstChild downward and nextSibling across, preserving sibling order.", "branch.preorder");
            for (Node child = node.firstChild; child != null; child = child.nextSibling) preorder(child);
        }

        private void levelorder() {
            Node[] queue = new Node[MAX_NODES];
            int head = 0;
            int tail = 0;
            queue[tail++] = root; // @source branch.queue-root
            showQueue(queue, head, tail);
            activeName = root.name;
            emit("queue", "Queue the root", "Start breadth-first traversal with " + root.name + ".",
                    "This bounded queue has room for all 15 possible live nodes.", "branch.queue-root");
            while (head < tail) {
                Node node = queue[head++]; // @source branch.dequeue
                output.add(node.name);
                activeName = node.name;
                activeSlot = -1;
                showQueue(queue, head, tail);
                emit("visit", "Visit " + node.name, "Take the oldest queued node and append it to the traversal output.",
                        "Its children will join the back of the queue in sibling order.", "branch.dequeue");
                for (Node child = node.firstChild; child != null; child = child.nextSibling) {
                    queue[tail++] = child; // @source branch.enqueue
                    activeName = child.name;
                    showQueue(queue, head, tail);
                    emit("queue", "Queue " + child.name, "Append " + child.name + " to the queue.",
                            "Queued nodes are waiting; they have not yet been appended to the traversal output.", "branch.enqueue");
                }
            }
        }

        private void showQueue(Node[] queue, int head, int tail) {
            queueView.clear();
            for (int i = head; i < tail; i++) queueView.add(queue[i].name);
        }

        private void emit(String phase, String title, String message, String note, String sourceId) {
            frames.add(new LabTrace.Frame(operationIndex, operation, phase, title, message, note, sourceId, snapshot()));
        }

        Map<String, Object> snapshot() {
            List<Map<String, Object>> nodes = new ArrayList<>();
            List<Map<String, Object>> edges = new ArrayList<>();
            collect(root, nodes, edges);
            if (staged != null) appendVisualNode(staged, true, nodes, edges);
            List<List<String>> rows = new ArrayList<>();
            int occupied = 0;
            int deleted = 0;
            for (int i = 0; i < INDEX_CAPACITY; i++) {
                if (index[i] != null) occupied++;
                if (tombstones[i]) deleted++;
                if (index[i] == null && !tombstones[i] && i != activeSlot) continue;
                rows.add(List.of((i == activeSlot ? "→ " : "") + i,
                        index[i] == null ? "—" : index[i].name,
                        index[i] == null ? "—" : Integer.toString(home(index[i].name)),
                        index[i] != null ? "OCCUPIED" : tombstones[i] ? "TOMBSTONE" : "EMPTY"));
            }
            List<Map<String, Object>> lanes = new ArrayList<>();
            lanes.add(Map.of("label", "Output", "items", new ArrayList<>(output)));
            if (operation.equals("levelorder")) lanes.add(Map.of("label", "Queue · oldest first", "items", new ArrayList<>(queueView)));
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("layout", "tree");
            view.put("nodes", nodes);
            view.put("edges", edges);
            view.put("lanes", lanes);
            view.put("tables", List.of(Map.of("label", "Name index · 32 slots · linear probing", "columns", List.of("Slot", "Name", "Home", "State"), "rows", rows)));
            view.put("summary", live + " live node" + (live == 1 ? "" : "s") + " · " + occupied + " indexed · " + deleted + " tombstones");
            view.put("output", new ArrayList<>(output));
            return view;
        }

        private void collect(Node node, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
            appendVisualNode(node, false, nodes, edges);
            for (Node child = node.firstChild; child != null; child = child.nextSibling) collect(child, nodes, edges);
        }

        private void appendVisualNode(Node node, boolean pending, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
            Map<String, Object> visual = new LinkedHashMap<>();
            visual.put("id", node.name);
            visual.put("label", node.name);
            visual.put("detail", pending ? stageNote : "child: " + nameOf(node.firstChild) + " · sibling: " + nameOf(node.nextSibling));
            visual.put("parent", pending || node.parent == null ? null : node.parent.name);
            visual.put("active", node.name.equals(activeName));
            visual.put("muted", pending);
            nodes.add(visual);
            if (node.firstChild != null) edges.add(edge(node, node.firstChild, "firstChild"));
            if (node.nextSibling != null) edges.add(edge(node, node.nextSibling, "nextSibling"));
        }

        private Map<String, Object> edge(Node from, Node to, String label) {
            return Map.of("from", from.name, "to", to.name, "label", label,
                    "active", from.name.equals(activeName) || to.name.equals(activeName));
        }

        private static String nameOf(Node node) { return node == null ? "∅" : node.name; }
    }
}
