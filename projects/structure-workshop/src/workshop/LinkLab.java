package workshop;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Collections;
import java.util.regex.Pattern;

/** An original doubly linked list experiment with reversible edits and truthful snapshots. */
public final class LinkLab {
    static final int MAX_INITIAL = 10;
    static final int MAX_LIVE = 16;
    static final int MAX_OPERATIONS = 24;
    static final int MAX_FRAMES = 512;
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,16}");
    private static final String TOOLS = "Custom node links; LinkedHashMap is the standard-library lookup map; ArrayDeque is the standard-library undo stack.";
    private static final String REWIRING = "This is an intermediate state: one pointer changes at a time, so reciprocal links and the lookup map may temporarily disagree.";

    private LinkLab() { }

    public static LabTrace run(String initial, String instructions) {
        if (instructions == null) throw new IllegalArgumentException("Instructions are required (they may be empty).");
        if (instructions.length() > 4096) throw new IllegalArgumentException("Keep instructions within 4,096 characters.");
        List<String> lines = instructions.lines().map(String::trim).filter(line -> !line.isEmpty()).toList();
        if (lines.size() > MAX_OPERATIONS) throw new IllegalArgumentException("Use at most 24 instructions.");
        Engine engine = new Engine(initial);
        for (String line : lines) engine.apply(line);
        return engine.trace();
    }

    private static final class Node {
        final String id;
        Node prev;
        Node next;
        Node(String id) { this.id = id; }
    }

    private record Command(String verb, String first, String second, String text) { }
    private record Edit(boolean insertion, Node node, Node left, Node right) {
        String label() { return (insertion ? "Undo insertion of " : "Restore ") + node.id; }
    }

    /** Package access supports structural tests without exposing mutable nodes to the UI. */
    static final class Engine {
        private Node head;
        private Node tail;
        private Node transientNode;
        private final LinkedHashMap<String, Node> byId = new LinkedHashMap<>();
        private final Deque<Edit> history = new ArrayDeque<>();
        private final List<String> operations = new ArrayList<>();
        private final List<LabTrace.Frame> frames = new ArrayList<>();
        private final List<String> output = new ArrayList<>();
        private int operationIndex = -1;
        private String operation = "Initial values";

        Engine(String initial) {
            if (initial == null) throw new IllegalArgumentException("Initial values are required (they may be empty).");
            if (initial.length() > 1024) throw new IllegalArgumentException("Initial values are too long.");
            String clean = initial.trim();
            String[] values = clean.isEmpty() ? new String[0] : clean.split(",", -1);
            if (values.length > MAX_INITIAL) throw new IllegalArgumentException("Use at most 10 initial node IDs.");
            for (String value : values) {
                String id = validId(value.trim());
                if (byId.containsKey(id)) throw new IllegalArgumentException("Initial IDs must be unique: " + id + ".");
                Node node = new Node(id);
                node.prev = tail;
                if (tail == null) head = node;
                else tail.next = node;
                tail = node;
                byId.put(id, node);
            }
            emit("initial", "Start with a linked list", "Each node stores the IDs of its previous and next neighbors. A null link marks an end.", TOOLS, null);
        }

        void apply(String line) {
            if (operations.size() == MAX_OPERATIONS) throw new IllegalArgumentException("Use at most 24 instructions.");
            Command command = parse(line);
            validate(command); // Validate the whole edit before changing links, history, or the trace.
            operations.add(command.text());
            operationIndex = operations.size() - 1;
            operation = command.text();
            switch (command.verb()) {
                case "insert-after" -> insert(byId.get(command.first()), command.second());
                case "prepend" -> insert(null, command.first());
                case "remove" -> remove(byId.get(command.first()));
                case "find" -> find(command.first());
                case "undo" -> undo();
                default -> throw new AssertionError("Validated command is unknown.");
            }
        }

        private void validate(Command command) {
            switch (command.verb()) {
                case "insert-after" -> {
                    requireNode(command.first());
                    validateNew(command.second());
                }
                case "prepend" -> validateNew(command.first());
                case "remove" -> {
                    requireNode(command.first());
                    requireHistorySpace();
                }
                case "find" -> { /* A missing ID is a valid lookup result. */ }
                case "undo" -> {
                    if (history.isEmpty()) throw new IllegalArgumentException("Nothing to undo. Insert or remove a node first.");
                }
                default -> throw new AssertionError("Validated command is unknown.");
            }
        }

        private void validateNew(String id) {
            if (byId.containsKey(id)) throw new IllegalArgumentException("Node " + id + " already exists. Choose a unique ID.");
            if (byId.size() >= MAX_LIVE) throw new IllegalArgumentException("The list is full: at most 16 live nodes.");
            requireHistorySpace();
        }

        private void requireHistorySpace() {
            if (history.size() >= MAX_OPERATIONS) throw new IllegalArgumentException("The undo stack is full: at most 24 saved edits.");
        }

        private void requireNode(String id) {
            if (!byId.containsKey(id)) throw new IllegalArgumentException("Node " + id + " does not exist.");
        }

        private void insert(Node left, String id) {
            Node right = left == null ? head : left.next;
            Node node = new Node(id); // @source link.insert.allocate
            transientNode = node;
            emit("allocate", "Allocate " + id, "The new node exists, but its links are null and it is not in the lookup map yet.", REWIRING, "link.insert.allocate", node);
            attach(node, left, right);
            history.push(new Edit(true, node, left, right)); // @source link.insert.history
            transientNode = null;
            emit("commit", "Insertion complete", "Saved an inverse edit on the undo stack. All next and previous links now agree.", TOOLS, "link.insert.history", node);
        }

        /** Used both for a new node and for restoring an existing detached node. */
        private void attach(Node node, Node left, Node right) {
            if (left != null) {
                node.prev = left; // @source link.attach.previous
                emit("link", "Set the new previous link", node.id + ".prev now points to " + left.id + ".", REWIRING, "link.attach.previous", node, left);
            }
            if (right != null) {
                node.next = right; // @source link.attach.next
                emit("link", "Set the new next link", node.id + ".next now points to " + right.id + ".", REWIRING, "link.attach.next", node, right);
            }
            if (left == null) {
                head = node; // @source link.attach.head
                emit("link", "Move the head", "The head now points to " + node.id + ".", REWIRING, "link.attach.head", node);
            } else {
                left.next = node; // @source link.attach.left
                emit("link", "Connect the left neighbor", left.id + ".next now points to " + node.id + ".", REWIRING, "link.attach.left", left, node);
            }
            if (right == null) {
                tail = node; // @source link.attach.tail
                emit("link", "Move the tail", "The tail now points to " + node.id + ".", REWIRING, "link.attach.tail", node);
            } else {
                right.prev = node; // @source link.attach.right
                emit("link", "Connect the right neighbor", right.id + ".prev now points to " + node.id + ".", REWIRING, "link.attach.right", right, node);
            }
            byId.put(node.id, node); // @source link.attach.index
            emit("index", "Add the lookup entry", "The standard-library map now resolves " + node.id + " to this node. The drawing shows real node links, not map buckets.", TOOLS, "link.attach.index", node);
        }

        private void remove(Node node) {
            Node left = node.prev;
            Node right = node.next;
            transientNode = node;
            detach(node);
            history.push(new Edit(false, node, left, right)); // @source link.remove.history
            transientNode = null;
            emit("commit", "Removal complete", "The detached node and its former neighbors are saved in an inverse edit. Undo can restore the same node.", TOOLS, "link.remove.history", left, right);
        }

        /** Unlinks a live node, preserving partial pointer states for inspection. */
        private void detach(Node node) {
            Node left = node.prev;
            Node right = node.next;
            if (left == null) {
                head = right; // @source link.detach.head
                emit("link", "Move the head past " + node.id, "The head now points to " + id(right) + ". The removed node is still visible while links are being cleared.", REWIRING, "link.detach.head", node, right);
            } else {
                left.next = right; // @source link.detach.left
                emit("link", "Bypass the node going forward", left.id + ".next now points to " + id(right) + ".", REWIRING, "link.detach.left", node, left, right);
            }
            if (right == null) {
                tail = left; // @source link.detach.tail
                emit("link", "Move the tail before " + node.id, "The tail now points to " + id(left) + ".", REWIRING, "link.detach.tail", node, left);
            } else {
                right.prev = left; // @source link.detach.right
                emit("link", "Bypass the node going backward", right.id + ".prev now points to " + id(left) + ".", REWIRING, "link.detach.right", node, left, right);
            }
            byId.remove(node.id); // @source link.detach.index
            emit("index", "Remove the lookup entry", "The map no longer resolves " + node.id + ". Its detached node is still held by this operation.", REWIRING, "link.detach.index", node);
            if (node.prev != null) {
                node.prev = null; // @source link.detach.previous
                emit("unlink", "Clear the detached previous link", node.id + ".prev is now null.", REWIRING, "link.detach.previous", node);
            }
            if (node.next != null) {
                node.next = null; // @source link.detach.next
                emit("unlink", "Clear the detached next link", node.id + ".next is now null.", REWIRING, "link.detach.next", node);
            }
        }

        private void find(String wanted) {
            Node node = byId.get(wanted); // @source link.find.lookup
            String result = node == null ? wanted + ": not found" : wanted + ": found (prev " + id(node.prev) + ", next " + id(node.next) + ")";
            output.add(result);
            emit("lookup", node == null ? "No matching node" : "Found " + wanted, result + ". Finding a node leaves the list and undo stack unchanged.", "This uses the standard-library LinkedHashMap lookup; it does not scan next links or display invented hash buckets.", "link.find.lookup", node);
        }

        private void undo() {
            Edit edit = history.pop(); // @source link.undo.pop
            transientNode = edit.node();
            emit("undo", "Pop the latest edit", edit.label() + ". The stack is last in, first out; lookups are not recorded here.", TOOLS, "link.undo.pop", edit.node());
            if (edit.insertion()) {
                detach(edit.node()); // @source link.undo.insertion
            } else {
                attach(edit.node(), edit.left(), edit.right()); // @source link.undo.removal
            }
            transientNode = null;
            emit("commit", "Undo complete", "Restored the prior list order and head/tail links. Undo itself does not create a new undo entry.", "The lookup map contains exactly the live nodes; its insertion order need not match the list order.", edit.insertion() ? "link.undo.insertion" : "link.undo.removal");
        }

        private void emit(String phase, String title, String message, String note, String source, Node... active) {
            if (frames.size() >= MAX_FRAMES) throw new IllegalStateException("Trace exceeded its bounded frame budget.");
            frames.add(new LabTrace.Frame(operationIndex, operation, phase, title, message, note, source, view(active)));
        }

        private Map<String, Object> view(Node... active) {
            Set<Node> highlighted = identitySet();
            for (Node node : active) if (node != null) highlighted.add(node);
            List<Node> visible = new ArrayList<>();
            Set<Node> seen = identitySet();
            for (Node node = head; node != null && seen.add(node); node = node.next) visible.add(node);
            for (Node node : byId.values()) if (seen.add(node)) visible.add(node);
            if (transientNode != null && seen.add(transientNode)) visible.add(transientNode);
            // In-progress links can still point to a node outside the head chain and lookup map.
            for (int i = 0; i < visible.size(); i++) {
                Node node = visible.get(i);
                if (node.prev != null && seen.add(node.prev)) visible.add(node.prev);
                if (node.next != null && seen.add(node.next)) visible.add(node.next);
            }
            List<Map<String, Object>> nodes = new ArrayList<>();
            List<Map<String, Object>> edges = new ArrayList<>();
            for (Node node : visible) {
                boolean indexed = byId.get(node.id) == node;
                String roles = (node == head ? " · head" : "") + (node == tail ? " · tail" : "") + (!indexed ? " · unindexed" : "");
                nodes.add(Map.of("id", node.id, "label", node.id, "detail", "prev " + id(node.prev) + " · next " + id(node.next) + roles, "active", highlighted.contains(node), "muted", !indexed));
                if (node.next != null) edges.add(Map.of("from", node.id, "to", node.next.id, "label", "next", "active", highlighted.contains(node)));
                if (node.prev != null) edges.add(Map.of("from", node.id, "to", node.prev.id, "label", "prev", "active", highlighted.contains(node)));
            }
            List<String> stack = history.stream().map(Edit::label).toList();
            List<List<String>> rows = new ArrayList<>();
            byId.forEach((key, node) -> rows.add(List.of(key, "node " + node.id)));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("layout", "list");
            result.put("nodes", nodes);
            result.put("edges", edges);
            result.put("lanes", List.of(Map.of("label", "Undo stack · ArrayDeque · top first", "items", stack), Map.of("label", "Lookup output", "items", new ArrayList<>(output))));
            result.put("tables", List.of(Map.of("label", "Lookup map · LinkedHashMap · insertion order", "columns", List.of("ID", "Node reference"), "rows", rows)));
            result.put("summary", "head " + id(head) + " · tail " + id(tail) + " · " + byId.size() + " lookup entries · " + history.size() + " undo edits");
            result.put("output", new ArrayList<>(output));
            return result;
        }

        LabTrace trace() { return new LabTrace(operations, frames); }
        List<String> order() {
            List<String> result = new ArrayList<>();
            Set<Node> seen = identitySet();
            for (Node node = head; node != null; node = node.next) {
                if (!seen.add(node)) throw new IllegalStateException("A next-link cycle exists.");
                result.add(node.id);
            }
            return List.copyOf(result);
        }
        String headId() { return id(head); }
        String tailId() { return id(tail); }
        int historySize() { return history.size(); }
        int lookupSize() { return byId.size(); }
        boolean consistent() {
            if ((head == null) != (tail == null)) return false;
            if (head != null && head.prev != null || tail != null && tail.next != null) return false;
            Set<Node> visited = identitySet();
            Node previous = null;
            for (Node node = head; node != null; node = node.next) {
                if (!visited.add(node) || node.prev != previous || byId.get(node.id) != node) return false;
                previous = node;
            }
            return previous == tail && visited.size() == byId.size() && visited.containsAll(byId.values()) && transientNode == null;
        }
    }

    private static Command parse(String line) {
        if (line == null || line.isBlank()) throw new IllegalArgumentException("An instruction cannot be empty.");
        String[] parts = line.trim().split("\\s+");
        String verb = parts[0];
        int count = switch (verb) {
            case "insert-after" -> 3;
            case "prepend", "remove", "find" -> 2;
            case "undo" -> 1;
            default -> throw new IllegalArgumentException("Unknown instruction '" + verb + "'. Use insert-after, prepend, remove, find, or undo.");
        };
        if (parts.length != count) throw new IllegalArgumentException("Use " + switch (verb) {
            case "insert-after" -> "insert-after EXISTING NEW";
            case "prepend" -> "prepend NEW";
            case "remove" -> "remove ID";
            case "find" -> "find ID";
            default -> "undo";
        } + ".");
        String first = count > 1 ? validId(parts[1]) : null;
        String second = count > 2 ? validId(parts[2]) : null;
        return new Command(verb, first, second, String.join(" ", parts));
    }

    private static String validId(String id) {
        if (!ID.matcher(id).matches()) throw new IllegalArgumentException("Node IDs need 1–16 letters, digits, underscores, or hyphens: '" + id + "'.");
        return id;
    }
    private static String id(Node node) { return node == null ? "null" : node.id; }
    private static Set<Node> identitySet() { return Collections.newSetFromMap(new IdentityHashMap<>()); }
}
