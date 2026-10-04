package workshop;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** An original dependency-ordering lab with an indexed binary min-heap. */
public final class DependencyLab {
    private static final int MAX_TASKS = 12;
    private static final int MAX_EDGES = 24;
    private static final int MAX_COMMANDS = 24;
    private static final Pattern ID = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,11}");

    private DependencyLab() { }

    public static LabTrace run(String initial, String instructions) {
        if (initial == null || instructions == null) {
            throw new IllegalArgumentException("Initial tasks and instructions are required.");
        }
        if (initial.length() > 512 || instructions.length() > 4096) {
            throw new IllegalArgumentException("This experiment is too large.");
        }
        String[] labels = initial.split(",", -1);
        if (labels.length > MAX_TASKS) throw new IllegalArgumentException("Use at most 12 tasks.");
        for (int i = 0; i < labels.length; i++) {
            labels[i] = labels[i].trim();
            if (!ID.matcher(labels[i]).matches()) {
                throw new IllegalArgumentException("Task names need 1–12 letters, digits, _ or -, beginning with a letter.");
            }
            for (int j = 0; j < i; j++) {
                if (labels[j].equals(labels[i])) throw new IllegalArgumentException("Task names must be unique: " + labels[i]);
            }
        }
        List<String> operations = new ArrayList<>();
        for (String line : instructions.split("\\R")) {
            if (!line.isBlank()) operations.add(line.trim().replaceAll("\\s+", " "));
        }
        if (operations.size() > MAX_COMMANDS) throw new IllegalArgumentException("Use at most 24 instructions.");
        Engine engine = new Engine(labels, operations);
        engine.frame("initial", "Your dependency graph", "Add dependencies, then request an order.", null);
        for (int i = 0; i < operations.size(); i++) {
            engine.operationIndex = i;
            String[] words = operations.get(i).split(" ");
            if (words.length == 3 && words[0].equals("link")) {
                engine.link(engine.task(words[1]), engine.task(words[2]));
            } else if (words.length == 1 && words[0].equals("order")) {
                engine.order();
            } else {
                throw new IllegalArgumentException("Instruction " + (i + 1) + ": use link BEFORE AFTER or order.");
            }
        }
        return new LabTrace(operations, engine.frames);
    }

    private static final class Engine {
        final String[] labels;
        final boolean[][] edges;
        final int[] indegree;
        final boolean[] emitted;
        final List<String> operations;
        final List<LabTrace.Frame> frames = new ArrayList<>();
        final List<String> output = new ArrayList<>();
        IndexedMinHeap heap;
        int operationIndex = -1;
        int edgeCount;
        int activeTask = -1;
        int activeOther = -1;
        int activeFrom = -1;
        int activeTo = -1;

        Engine(String[] labels, List<String> operations) {
            this.labels = labels;
            this.operations = operations;
            edges = new boolean[labels.length][labels.length];
            indegree = new int[labels.length];
            emitted = new boolean[labels.length];
        }

        int task(String label) {
            for (int i = 0; i < labels.length; i++) if (labels[i].equals(label)) return i;
            throw new IllegalArgumentException("Unknown task: " + label);
        }

        void reset() {
            heap = null;
            Arrays.fill(indegree, 0);
            Arrays.fill(emitted, false);
            output.clear();
            activeTask = activeOther = activeFrom = activeTo = -1;
            for (int from = 0; from < labels.length; from++) {
                for (int to = 0; to < labels.length; to++) {
                    if (edges[from][to]) indegree[to]++;
                }
            }
        }

        void link(int from, int to) {
            reset();
            activeTask = activeFrom = from;
            activeOther = activeTo = to;
            if (edges[from][to]) { // @source dependency.duplicate
                frame("duplicate", "Dependency already exists", labels[from] + " → " + labels[to]
                        + " is unchanged. Each dependency counts only once.", "dependency.duplicate");
                return;
            }
            if (edgeCount >= MAX_EDGES) throw new IllegalArgumentException("Use at most 24 dependencies.");
            edges[from][to] = true; // @source dependency.link
            edgeCount++;
            indegree[to]++;
            frame("link", "Add a dependency", labels[from] + " must happen before " + labels[to] + ".", "dependency.link");
        }

        void order() {
            reset(); // @source dependency.reset
            frame("reset", "Start a fresh ordering", "Recompute every indegree from the saved dependencies; clear the previous result.", "dependency.reset");
            heap = new IndexedMinHeap(labels, indegree, (phase, message, sourceId, first, second) -> {
                activeTask = first;
                activeOther = second;
                frame(phase, heapTitle(phase), message, sourceId);
            });
            for (int task = 0; task < labels.length; task++) heap.add(task);
            activeTask = activeOther = -1;
            frame("ready", "Heap is ready", "The root has the smallest indegree; equal counts are ordered by task name.", "dependency.compare");
            while (heap.size() > 0) {
                int next = heap.peek(); // @source dependency.peek
                activeTask = next;
                activeOther = activeFrom = activeTo = -1;
                frame("inspect", "Inspect the next task", labels[next] + " has " + indegree[next] + " unmet dependencies.", "dependency.peek");
                if (indegree[next] != 0) { // @source dependency.blocked
                    frame("blocked", "Ordering is blocked", "Every remaining task has an unmet dependency. A cycle prevents completion; remaining tasks can also include tasks downstream of that cycle.", "dependency.blocked");
                    return;
                }
                int current = heap.pop();
                emitted[current] = true;
                output.add(labels[current]); // @source dependency.emit
                activeTask = current;
                activeOther = -1;
                frame("emit", "Add a ready task to the result", labels[current] + " has no unmet dependencies and is now ordered.", "dependency.emit");
                for (int to = 0; to < labels.length; to++) {
                    if (edges[current][to]) {
                        activeFrom = current;
                        activeTo = to;
                        heap.decreaseKey(to, indegree[to] - 1);
                    }
                }
                activeFrom = activeTo = -1;
            }
            activeTask = activeOther = -1;
            frame("complete", "Every task has an order", "All " + labels.length + " tasks were emitted. Every dependency points forward in the result.", "dependency.emit");
        }

        String heapTitle(String phase) {
            return switch (phase) {
                case "heap-add" -> "Append a task to the heap";
                case "heap-swap" -> "Restore heap order";
                case "heap-pop" -> "Remove the heap root";
                case "decrease" -> "One dependency is satisfied";
                default -> "Update the heap";
            };
        }

        void frame(String phase, String title, String message, String sourceId) {
            List<Map<String, Object>> nodes = new ArrayList<>();
            List<Map<String, Object>> links = new ArrayList<>();
            List<List<String>> positions = new ArrayList<>();
            for (int i = 0; i < labels.length; i++) {
                nodes.add(Map.of("id", labels[i], "label", labels[i],
                        "detail", emitted[i] ? "ordered" : "indegree " + indegree[i],
                        "active", i == activeTask || i == activeOther, "muted", emitted[i]));
                int position = heap == null ? -1 : heap.positionOf(i);
                positions.add(List.of(labels[i], position < 0 ? "—" : Integer.toString(position),
                        Integer.toString(indegree[i]), emitted[i] ? "ordered" : position >= 0 ? "in heap" : "not in heap"));
                for (int to = 0; to < labels.length; to++) {
                    if (edges[i][to]) {
                        links.add(Map.of("from", labels[i], "to", labels[to], "label", "",
                                "active", i == activeFrom && to == activeTo));
                    }
                }
            }
            List<String> heapItems = new ArrayList<>();
            if (heap != null) {
                int[] array = heap.copyHeap();
                for (int i = 0; i < array.length; i++) heapItems.add(i + ": " + labels[array[i]] + " (" + indegree[array[i]] + ")");
            }
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("layout", "graph");
            view.put("nodes", nodes);
            view.put("edges", links);
            view.put("lanes", List.of(Map.of("label", "Min-heap · array order · indegree in parentheses", "items", heapItems)));
            view.put("tables", List.of(Map.of("label", "Indexed positions", "columns", List.of("Task", "Heap index", "Indegree", "State"), "rows", positions)));
            view.put("summary", output.size() + " / " + labels.length + " ordered · " + edgeCount + " dependencies");
            view.put("output", new ArrayList<>(output));
            String note = "Priority: indegree, then task name (case-sensitive). Heap positions start at 0. Swaps update both positions. Dependencies stay saved for the next order command.";
            frames.add(new LabTrace.Frame(operationIndex, operationIndex < 0 ? "Initial state" : operations.get(operationIndex), phase,
                    title, message, note, sourceId, view));
        }
    }

    @FunctionalInterface
    interface HeapObserver {
        void changed(String phase, String message, String sourceId, int first, int second);
    }

    /** Stores task IDs in a binary heap and keeps the inverse position mapping. */
    static final class IndexedMinHeap {
        private final String[] labels;
        private final int[] keys;
        private final int[] heap;
        private final int[] positions;
        private final HeapObserver observer;
        private int size;

        IndexedMinHeap(String[] labels, int[] keys, HeapObserver observer) {
            if (labels.length != keys.length) throw new IllegalArgumentException("Each task needs a key.");
            this.labels = labels;
            this.keys = keys;
            this.observer = observer;
            heap = new int[labels.length];
            positions = new int[labels.length];
            Arrays.fill(positions, -1);
        }

        int size() { return size; }
        int[] copyHeap() { return Arrays.copyOf(heap, size); }
        int positionOf(int task) { checkTask(task); return positions[task]; }
        int peek() {
            if (size == 0) throw new IllegalStateException("The heap is empty.");
            return heap[0];
        }

        void add(int task) {
            checkTask(task);
            if (positions[task] >= 0) throw new IllegalArgumentException("Task is already in the heap.");
            heap[size] = task; // @source dependency.heap-add
            positions[task] = size++;
            changed("heap-add", "Append " + labels[task] + " at heap index " + positions[task] + ".", "dependency.heap-add", task, -1);
            siftUp(positions[task]);
        }

        void decreaseKey(int task, int newKey) {
            checkTask(task);
            if (positions[task] < 0) throw new IllegalArgumentException("Task is not in the heap.");
            if (newKey < 0 || newKey > keys[task]) throw new IllegalArgumentException("A decreased indegree must be nonnegative and cannot increase.");
            keys[task] = newKey; // @source dependency.decrease
            changed("decrease", labels[task] + " now has " + newKey + " unmet dependencies. Restore its heap position if needed.", "dependency.decrease", task, -1);
            siftUp(positions[task]);
        }

        int pop() {
            int removed = peek();
            int replacement = heap[--size]; // @source dependency.heap-pop
            positions[removed] = -1;
            if (size > 0) {
                heap[0] = replacement;
                positions[replacement] = 0;
            }
            changed("heap-pop", "Remove " + labels[removed] + (size == 0 ? "; the heap is empty." : "; move " + labels[replacement] + " from the last slot to the root."), "dependency.heap-pop", removed, size == 0 ? -1 : replacement);
            siftDown(0);
            return removed;
        }

        private void siftUp(int position) {
            while (position > 0) {
                int parent = (position - 1) / 2;
                if (!less(heap[position], heap[parent])) break;
                swap(position, parent);
                position = parent;
            }
        }

        private void siftDown(int position) {
            while (2 * position + 1 < size) {
                int child = 2 * position + 1;
                if (child + 1 < size && less(heap[child + 1], heap[child])) child++;
                if (!less(heap[child], heap[position])) break;
                swap(position, child);
                position = child;
            }
        }

        private boolean less(int left, int right) {
            return keys[left] < keys[right] || (keys[left] == keys[right] && labels[left].compareTo(labels[right]) < 0); // @source dependency.compare
        }

        private void swap(int left, int right) {
            int first = heap[left];
            int second = heap[right];
            heap[left] = second; // @source dependency.swap
            heap[right] = first;
            positions[first] = right;
            positions[second] = left;
            changed("heap-swap", "Swap " + labels[first] + " at index " + left + " with " + labels[second] + " at index " + right + "; update both indexed positions.", "dependency.swap", first, second);
        }

        private void checkTask(int task) {
            if (task < 0 || task >= labels.length) throw new IllegalArgumentException("Unknown task index.");
        }

        private void changed(String phase, String message, String sourceId, int first, int second) {
            if (observer != null) observer.changed(phase, message, sourceId, first, second);
        }

        boolean invariantHolds() {
            boolean[] seen = new boolean[labels.length];
            for (int i = 0; i < size; i++) {
                int task = heap[i];
                if (seen[task] || positions[task] != i) return false;
                seen[task] = true;
                if (i > 0 && less(task, heap[(i - 1) / 2])) return false;
            }
            for (int task = 0; task < labels.length; task++) if (!seen[task] && positions[task] != -1) return false;
            return true;
        }
    }
}
