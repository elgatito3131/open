package observatory;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/** A small generic contiguous buffer that records its actual mutations. */
public final class DynamicBuffer<E> {
    public static final int INITIAL_CAPACITY = 4;
    public static final int MAX_CAPACITY = 128;

    public enum Growth {
        DOUBLE, BALANCED;

        public int nextCapacity(int current) {
            int proposed = this == DOUBLE ? current * 2 : current + (current + 1) / 2;
            return Math.min(MAX_CAPACITY, proposed);
        }
    }

    /** Separate categories: value assignments, growth copies, shifts, growth allocations. */
    public record Metrics(int writes, int copies, int shifts, int allocations) {}

    public record Snapshot<E>(List<E> slots, int size, int capacity, Metrics metrics) {
        public Snapshot {
            slots = immutableWithNulls(slots);
        }
    }

    public record Step<E>(int index, int operationIndex, String operation, String phase,
            String message, List<E> slots, int size, int capacity, List<E> oldSlots,
            List<Integer> activeIndices, Metrics metrics, String sourceId) {
        public Step {
            slots = immutableWithNulls(slots);
            oldSlots = oldSlots == null ? null : immutableWithNulls(oldSlots);
            activeIndices = List.copyOf(activeIndices);
        }
    }

    private Object[] elements;
    private int size;
    private int writes;
    private int copies;
    private int shifts;
    private int allocations;
    private int operationIndex = -1;
    private String operation = "";
    private final Growth growth;
    private final List<Step<E>> steps = new ArrayList<>();
    private final List<String> operations = new ArrayList<>();

    public DynamicBuffer(Growth growth) {
        this(List.of(), growth);
    }

    /** Initial values establish the baseline, so their setup is not counted or traced. */
    public DynamicBuffer(List<? extends E> initial, Growth growth) {
        this.growth = Objects.requireNonNull(growth, "growth");
        Objects.requireNonNull(initial, "initial");
        if (initial.size() > MAX_CAPACITY) {
            throw new IllegalArgumentException("Initial values exceed maximum capacity 128.");
        }
        int capacity = INITIAL_CAPACITY;
        while (capacity < initial.size()) capacity = growth.nextCapacity(capacity);
        elements = new Object[capacity];
        for (E value : initial) elements[size++] = value;
    }

    public int size() { return size; }
    public int capacity() { return elements.length; }
    public Growth growth() { return growth; }
    public Metrics metrics() { return new Metrics(writes, copies, shifts, allocations); }
    public Snapshot<E> snapshot() { return new Snapshot<>(slots(elements), size, capacity(), metrics()); }
    public List<Step<E>> steps() { return List.copyOf(steps); }
    public List<String> operations() { return List.copyOf(operations); }

    @SuppressWarnings("unchecked")
    public E get(int index) {
        checkElementIndex(index);
        return (E) elements[index];
    }

    public void append(E value) {
        checkRoom();
        begin("append " + value);
        ensureCapacity();
        elements[size] = value; // @source append.write
        writes++;
        emit("write", "Write " + value + " into slot " + size + ".", null,
                List.of(size), "append.write");
        size++; // @source append.commit
        emit("commit", "Append complete. The logical size is now " + size + ".", null,
                List.of(size - 1), "append.commit");
    }

    public void insert(int index, E value) {
        if (index < 0 || index > size) {
            throw new IndexOutOfBoundsException("Insert index must be between 0 and " + size + ".");
        }
        checkRoom();
        begin("insert " + index + " " + value);
        ensureCapacity();
        for (int destination = size; destination > index; destination--) {
            elements[destination] = elements[destination - 1]; // @source insert.shift
            shifts++;
            emit("shift", "Move slot " + (destination - 1) + " to slot " + destination
                    + " to make room. Shift from right to left to preserve values.", null,
                    List.of(destination - 1, destination), "insert.shift");
        }
        elements[index] = value; // @source insert.write
        writes++;
        emit("write", "Write " + value + " into the opening at slot " + index + ".", null,
                List.of(index), "insert.write");
        size++; // @source insert.commit
        emit("commit", "Insert complete. The logical size is now " + size + ".", null,
                List.of(index), "insert.commit");
    }

    public E remove(int index) {
        checkElementIndex(index);
        E removed = get(index);
        begin("remove " + index);
        for (int destination = index; destination < size - 1; destination++) {
            elements[destination] = elements[destination + 1]; // @source remove.shift
            shifts++;
            emit("shift", "Move slot " + (destination + 1) + " to slot " + destination
                    + " to close the gap.", null,
                    List.of(destination, destination + 1), "remove.shift");
        }
        elements[size - 1] = null; // @source remove.clear
        emit("clear", "Clear the vacated final slot so the buffer no longer retains its value.",
                null, List.of(size - 1), "remove.clear");
        size--; // @source remove.commit
        emit("commit", "Remove complete. Size is " + size + "; capacity stays " + capacity() + ".",
                null, List.of(size), "remove.commit");
        return removed;
    }

    public E set(int index, E value) {
        checkElementIndex(index);
        E previous = get(index);
        begin("set " + index + " " + value);
        elements[index] = value; // @source set.write
        writes++;
        emit("write", "Replace slot " + index + " with " + value + ". No movement is needed.",
                null, List.of(index), "set.write");
        emit("commit", "Set complete. Size and capacity are unchanged.",
                null, List.of(index), "set.write");
        return previous;
    }

    private void ensureCapacity() {
        if (size < elements.length) return;
        Object[] old = elements;
        int next = growth.nextCapacity(old.length);
        elements = new Object[next]; // @source resize.allocate
        allocations++;
        emit("allocation", "The buffer is full. Allocate " + next
                + " slots and retain the old " + old.length + " slots while copying.",
                old, List.of(), "resize.allocate");
        for (int index = 0; index < size; index++) {
            elements[index] = old[index]; // @source resize.copy
            copies++;
            emit("copy", "Copy old slot " + index + " into new slot " + index + ".",
                    old, List.of(index), "resize.copy");
        }
        old = null; // @source resize.commit
        emit("commit", "Growth complete. Release the old buffer; the new capacity is " + next + ".",
                old, List.of(), "resize.commit");
    }

    private void begin(String description) {
        operation = description;
        operationIndex++;
        operations.add(description);
    }

    private void checkRoom() {
        if (size == MAX_CAPACITY) throw new IllegalStateException("Maximum capacity 128 reached.");
    }

    private void checkElementIndex(int index) {
        if (index < 0 || index >= size) {
            throw new IndexOutOfBoundsException(size == 0 ? "The buffer is empty."
                    : "Index must be between 0 and " + (size - 1) + ".");
        }
    }

    private void emit(String phase, String message, Object[] old,
            List<Integer> activeIndices, String sourceId) {
        steps.add(new Step<>(steps.size(), operationIndex, operation, phase, message,
                slots(elements), size, capacity(), old == null ? null : slots(old),
                activeIndices, metrics(), sourceId));
    }

    @SuppressWarnings("unchecked")
    private List<E> slots(Object[] array) {
        List<E> result = new ArrayList<>(array.length);
        for (Object value : array) result.add((E) value);
        return result;
    }

    private static <T> List<T> immutableWithNulls(List<? extends T> values) {
        return Collections.unmodifiableList(new ArrayList<>(values));
    }
}
