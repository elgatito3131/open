package observatory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Random;

/** Dependency-free contract tests. Run with: java observatory.DynamicBufferTest. */
public final class DynamicBufferTest {
    private static int assertions;

    public static void main(String[] args) {
        testConstruction();
        for (DynamicBuffer.Growth growth : DynamicBuffer.Growth.values()) {
            testCountersAndResizeTrace(growth);
            testBoundariesAndInvalidOperations(growth);
            testMaximumCapacity(growth);
            testNullsAndStrings(growth);
            testImmutableDetachedHistory(growth);
            for (long seed : new long[] {7L, 42L, 262L, 367L}) {
                testRandomOperations(growth, seed);
            }
        }
        testRecordDefensiveCopies();
        System.out.println("DynamicBufferTest passed (" + assertions + " assertions).");
    }

    private static void testConstruction() {
        equal(4, DynamicBuffer.INITIAL_CAPACITY, "initial capacity constant");
        equal(128, DynamicBuffer.MAX_CAPACITY, "maximum capacity constant");
        for (DynamicBuffer.Growth growth : DynamicBuffer.Growth.values()) {
            for (int size : new int[] {0, 1, 4, 5, 6, 7, 9, 10, 127, 128}) {
                List<Integer> initial = new ArrayList<>();
                for (int index = 0; index < size; index++) initial.add(index);
                DynamicBuffer<Integer> buffer = new DynamicBuffer<>(initial, growth);
                assertContents(buffer, initial, "initial values " + growth + "/" + size);
                equal(capacityFor(size, growth), buffer.capacity(), "initial capacity");
                equal(growth, buffer.growth(), "selected growth policy");
                equal(new DynamicBuffer.Metrics(0, 0, 0, 0), buffer.metrics(), "baseline metrics");
                check(buffer.steps().isEmpty(), "construction has no trace");
                check(buffer.operations().isEmpty(), "construction has no operations");
                initial.clear();
                equal(size, buffer.size(), "initial list is structurally detached");
                if (size > 0) equal(0, buffer.get(0), "initial values survive list mutation");
            }
        }
        equal(8, DynamicBuffer.Growth.DOUBLE.nextCapacity(4), "double growth");
        equal(6, DynamicBuffer.Growth.BALANCED.nextCapacity(4), "balanced growth");
        equal(14, DynamicBuffer.Growth.BALANCED.nextCapacity(9), "balanced growth rounds up");
        equal(128, DynamicBuffer.Growth.DOUBLE.nextCapacity(72), "double capacity clamp");
        equal(128, DynamicBuffer.Growth.BALANCED.nextCapacity(108), "balanced capacity clamp");
        throwsType(NullPointerException.class, () -> new DynamicBuffer<Integer>(null), "null policy");
        throwsType(NullPointerException.class,
                () -> new DynamicBuffer<Integer>(null, DynamicBuffer.Growth.DOUBLE), "null initial list");
        throwsType(IllegalArgumentException.class,
                () -> new DynamicBuffer<>(Collections.nCopies(129, 1), DynamicBuffer.Growth.DOUBLE),
                "too many initial values");
    }

    private static void testCountersAndResizeTrace(DynamicBuffer.Growth growth) {
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(List.of(10, 20, 30, 40), growth);
        buffer.append(50);
        equal(new DynamicBuffer.Metrics(1, 4, 0, 1), buffer.metrics(), "append with growth counters");
        List<DynamicBuffer.Step<Integer>> trace = buffer.steps();
        equal(List.of("allocation", "copy", "copy", "copy", "copy", "commit", "write", "commit"),
                trace.stream().map(DynamicBuffer.Step::phase).toList(), "resize phases");
        equal("resize.allocate", trace.get(0).sourceId(), "allocation source");
        equal(new DynamicBuffer.Metrics(0, 0, 0, 1), trace.get(0).metrics(), "allocation counters");
        equal(List.of(10, 20, 30, 40), trace.get(0).oldSlots(), "old storage during allocation");
        check(trace.get(0).slots().stream().allMatch(Objects::isNull), "new allocation begins empty");
        for (int copied = 1; copied <= 4; copied++) {
            DynamicBuffer.Step<Integer> step = trace.get(copied);
            equal(copied, step.metrics().copies(), "one copy per trace step");
            equal(List.of(copied - 1), step.activeIndices(), "copy highlights destination");
            equal(List.of(10, 20, 30, 40), step.oldSlots(), "old storage survives each copy");
            for (int index = 0; index < step.capacity(); index++) {
                equal(index < copied ? (index + 1) * 10 : null, step.slots().get(index),
                        "copy step contains only copied prefix");
            }
        }
        equal(null, trace.get(5).oldSlots(), "growth commit releases old storage");
        equal("resize.commit", trace.get(5).sourceId(), "growth commit source");
        equal(4, trace.get(6).size(), "write precedes size commit");
        equal(5, trace.get(7).size(), "append commits new size");

        int beforeInsert = buffer.steps().size();
        buffer.insert(2, 99);
        equal(new DynamicBuffer.Metrics(2, 4, 3, 1), buffer.metrics(), "middle insert counters");
        assertContents(buffer, List.of(10, 20, 99, 30, 40, 50), "middle insert values");
        List<DynamicBuffer.Step<Integer>> insert = buffer.steps().subList(beforeInsert, buffer.steps().size());
        equal(List.of(4, 5), insert.get(0).activeIndices(), "insert shifts rightmost value first");
        equal(List.of(3, 4), insert.get(1).activeIndices(), "insert shifts right to left");
        equal(List.of(2, 3), insert.get(2).activeIndices(), "insert reaches opening");

        int beforeRemove = buffer.steps().size();
        equal(20, buffer.remove(1), "remove returns removed value");
        equal(new DynamicBuffer.Metrics(2, 4, 7, 1), buffer.metrics(), "remove counters exclude clear");
        assertContents(buffer, List.of(10, 99, 30, 40, 50), "middle remove values");
        List<DynamicBuffer.Step<Integer>> remove = buffer.steps().subList(beforeRemove, buffer.steps().size());
        equal(List.of(1, 2), remove.get(0).activeIndices(), "remove shifts leftmost value first");
        equal("clear", remove.get(4).phase(), "remove traces clearing retained reference");
        equal(null, remove.get(4).slots().get(5), "vacated slot is cleared before commit");
        equal(30, buffer.set(2, 300), "set returns previous value");
        equal(new DynamicBuffer.Metrics(3, 4, 7, 1), buffer.metrics(), "set changes only write count");
        assertContents(buffer, List.of(10, 99, 300, 40, 50), "set preserves surrounding values");
        int capacity = buffer.capacity();
        equal(50, buffer.remove(buffer.size() - 1), "tail remove return value");
        equal(new DynamicBuffer.Metrics(3, 4, 7, 1), buffer.metrics(), "tail remove needs no shifts");
        equal(capacity, buffer.capacity(), "remove does not shrink allocation");
        assertTraceMetadata(buffer);
    }

    private static void testBoundariesAndInvalidOperations(DynamicBuffer.Growth growth) {
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(growth);
        assertInvalidIndices(buffer);
        buffer.insert(0, 10);
        buffer.insert(0, 20);
        buffer.insert(buffer.size(), 30);
        assertContents(buffer, List.of(20, 10, 30), "insert at both boundaries");
        assertInvalidIndices(buffer);
        assertUnchanged(buffer, () -> equal(20, buffer.get(0), "read first"), null, "get is read-only");
        equal(20, buffer.remove(0), "remove first");
        equal(30, buffer.remove(buffer.size() - 1), "remove last");
        equal(10, buffer.remove(0), "remove only value");
        assertContents(buffer, List.of(), "remove down to empty");
        equal(4, buffer.capacity(), "empty buffer keeps allocation");
        assertInvalidIndices(buffer);
    }

    private static void assertInvalidIndices(DynamicBuffer<Integer> buffer) {
        for (int index : new int[] {Integer.MIN_VALUE, -1, buffer.size(), Integer.MAX_VALUE}) {
            assertUnchanged(buffer, () -> buffer.get(index), IndexOutOfBoundsException.class, "invalid get " + index);
            assertUnchanged(buffer, () -> buffer.set(index, 12), IndexOutOfBoundsException.class, "invalid set " + index);
            assertUnchanged(buffer, () -> buffer.remove(index), IndexOutOfBoundsException.class, "invalid remove " + index);
        }
        for (int index : new int[] {Integer.MIN_VALUE, -1, buffer.size() + 1, Integer.MAX_VALUE}) {
            assertUnchanged(buffer, () -> buffer.insert(index, 12), IndexOutOfBoundsException.class, "invalid insert " + index);
        }
    }

    private static void testMaximumCapacity(DynamicBuffer.Growth growth) {
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(growth);
        List<Integer> reference = new ArrayList<>();
        int capacity = 4;
        int copies = 0;
        int allocations = 0;
        for (int index = 0; index < 128; index++) {
            if (index == capacity) {
                copies += index;
                allocations++;
                capacity = nextCapacity(capacity, growth);
            }
            buffer.append(index);
            reference.add(index);
            equal(capacity, buffer.capacity(), "capacity along growth sequence");
            equal(new DynamicBuffer.Metrics(index + 1, copies, 0, allocations), buffer.metrics(), "growth sequence counters");
        }
        assertContents(buffer, reference, "all 128 slots usable");
        equal(128, buffer.capacity(), "final capacity is exactly maximum");
        assertUnchanged(buffer, () -> buffer.append(129), IllegalStateException.class, "append at maximum");
        assertUnchanged(buffer, () -> buffer.insert(0, 129), IllegalStateException.class, "front insert at maximum");
        assertUnchanged(buffer, () -> buffer.insert(128, 129), IllegalStateException.class, "tail insert at maximum");
        assertInvalidIndices(buffer);
        equal(127, buffer.remove(127), "remove permits reuse after maximum");
        buffer.insert(buffer.size(), 999);
        reference.set(127, 999);
        assertContents(buffer, reference, "reuse final slot after maximum");
        equal(allocations, buffer.metrics().allocations(), "reusing slot does not reallocate");
    }

    private static void testNullsAndStrings(DynamicBuffer.Growth growth) {
        DynamicBuffer<String> buffer = new DynamicBuffer<>(Arrays.asList("alpha", null, "omega"), growth);
        equal(null, buffer.get(1), "null is a logical value");
        buffer.append(null);
        buffer.insert(0, "☕ café and spaces");
        equal(null, buffer.set(2, ""), "set returns a stored null");
        equal("alpha", buffer.remove(1), "generic remove returns String");
        assertContents(buffer, Arrays.asList("☕ café and spaces", "", "omega", null), "generic String and null values");
        equal(null, buffer.remove(buffer.size() - 1), "remove returns a stored null");
        buffer.set(0, null);
        assertContents(buffer, Arrays.asList(null, "", "omega"), "set accepts null");
    }

    private static void testImmutableDetachedHistory(DynamicBuffer.Growth growth) {
        DynamicBuffer<String> buffer = new DynamicBuffer<>(Arrays.asList("a", null, "c", "d"), growth);
        DynamicBuffer.Snapshot<String> before = buffer.snapshot();
        buffer.append("e");
        List<DynamicBuffer.Step<String>> savedSteps = buffer.steps();
        List<String> savedOperations = buffer.operations();
        List<List<String>> savedSlots = new ArrayList<>();
        List<List<String>> savedOldSlots = new ArrayList<>();
        for (DynamicBuffer.Step<String> step : savedSteps) {
            savedSlots.add(new ArrayList<>(step.slots()));
            savedOldSlots.add(step.oldSlots() == null ? null : new ArrayList<>(step.oldSlots()));
        }
        throwsType(UnsupportedOperationException.class, () -> before.slots().set(0, "x"), "snapshot slots cannot change");
        throwsType(UnsupportedOperationException.class, () -> before.slots().add("x"), "snapshot slots cannot grow");
        throwsType(UnsupportedOperationException.class, () -> savedSteps.clear(), "trace list cannot change");
        throwsType(UnsupportedOperationException.class, () -> savedOperations.add("fake"), "operation list cannot change");
        throwsType(UnsupportedOperationException.class, () -> savedSteps.get(0).slots().set(0, "x"), "step slots cannot change");
        throwsType(UnsupportedOperationException.class, () -> savedSteps.get(0).oldSlots().set(0, "x"), "old slots cannot change");
        throwsType(UnsupportedOperationException.class, () -> savedSteps.get(1).activeIndices().set(0, 3), "active indices cannot change");
        buffer.set(0, "changed");
        buffer.remove(1);
        buffer.insert(0, "new");
        equal(Arrays.asList("a", null, "c", "d"), before.slots(), "snapshot detached from later mutations");
        equal(4, before.size(), "snapshot size detached");
        equal(new DynamicBuffer.Metrics(0, 0, 0, 0), before.metrics(), "snapshot metrics detached");
        equal(8, savedSteps.size(), "retrieved trace list detached from later operations");
        equal(List.of("append e"), savedOperations, "retrieved operation list detached");
        for (int index = 0; index < savedSteps.size(); index++) {
            equal(savedSlots.get(index), savedSteps.get(index).slots(), "historical slots detached");
            equal(savedOldSlots.get(index), savedSteps.get(index).oldSlots(), "historical old storage detached");
        }
    }

    private static void testRecordDefensiveCopies() {
        List<String> slots = new ArrayList<>(Arrays.asList("a", null));
        List<String> oldSlots = new ArrayList<>(Arrays.asList(null, "b"));
        List<Integer> active = new ArrayList<>(List.of(1));
        DynamicBuffer.Metrics metrics = new DynamicBuffer.Metrics(1, 2, 3, 4);
        DynamicBuffer.Snapshot<String> snapshot = new DynamicBuffer.Snapshot<>(slots, 1, 2, metrics);
        DynamicBuffer.Step<String> step = new DynamicBuffer.Step<>(0, 0, "example", "copy", "example",
                slots, 1, 2, oldSlots, active, metrics, "resize.copy");
        slots.set(0, "changed");
        oldSlots.clear();
        active.set(0, 0);
        equal(Arrays.asList("a", null), snapshot.slots(), "snapshot copies constructor list");
        equal(Arrays.asList("a", null), step.slots(), "step copies constructor slots");
        equal(Arrays.asList(null, "b"), step.oldSlots(), "step copies constructor old slots");
        equal(List.of(1), step.activeIndices(), "step copies constructor active indices");
    }

    private static void testRandomOperations(DynamicBuffer.Growth growth, long seed) {
        Random random = new Random(seed);
        DynamicBuffer<Integer> buffer = new DynamicBuffer<>(growth);
        ArrayList<Integer> reference = new ArrayList<>();
        int capacity = 4;
        int writes = 0;
        int copies = 0;
        int shifts = 0;
        int allocations = 0;
        int operations = 0;
        for (int iteration = 0; iteration < 350; iteration++) {
            String context = growth + " seed=" + seed + " iteration=" + iteration;
            int choice = reference.isEmpty() ? random.nextInt(2) : random.nextInt(5);
            if (reference.size() == 128 && choice < 2) choice = 2;
            Integer value = random.nextInt(9) == 0 ? null : random.nextInt(2001) - 1000;
            if (choice < 2 && reference.size() == capacity) {
                copies += reference.size();
                allocations++;
                capacity = nextCapacity(capacity, growth);
            }
            switch (choice) {
                case 0 -> {
                    buffer.append(value);
                    reference.add(value);
                    writes++;
                    operations++;
                }
                case 1 -> {
                    int index = random.nextInt(reference.size() + 1);
                    shifts += reference.size() - index;
                    buffer.insert(index, value);
                    reference.add(index, value);
                    writes++;
                    operations++;
                }
                case 2 -> {
                    int index = random.nextInt(reference.size());
                    shifts += reference.size() - index - 1;
                    equal(reference.remove(index), buffer.remove(index), context + " remove result");
                    operations++;
                }
                case 3 -> {
                    int index = random.nextInt(reference.size());
                    equal(reference.set(index, value), buffer.set(index, value), context + " set result");
                    writes++;
                    operations++;
                }
                case 4 -> {
                    int index = random.nextInt(reference.size());
                    equal(reference.get(index), buffer.get(index), context + " get result");
                }
                default -> throw new AssertionError("Unknown random operation");
            }
            assertContents(buffer, reference, context);
            equal(capacity, buffer.capacity(), context + " capacity");
            equal(new DynamicBuffer.Metrics(writes, copies, shifts, allocations), buffer.metrics(), context + " metrics");
            equal(operations, buffer.operations().size(), context + " operation count");
            if (iteration % 71 == 0) assertInvalidIndices(buffer);
        }
        assertTraceMetadata(buffer);
    }

    private static <E> void assertContents(DynamicBuffer<E> buffer, List<E> expected, String context) {
        DynamicBuffer.Snapshot<E> snapshot = buffer.snapshot();
        equal(expected.size(), buffer.size(), context + " logical size");
        equal(expected.size(), snapshot.size(), context + " snapshot size");
        equal(buffer.capacity(), snapshot.capacity(), context + " snapshot capacity");
        equal(buffer.capacity(), snapshot.slots().size(), context + " physical slots");
        equal(buffer.metrics(), snapshot.metrics(), context + " snapshot metrics");
        equal(expected, snapshot.slots().subList(0, expected.size()), context + " active values");
        for (int index = 0; index < expected.size(); index++) {
            equal(expected.get(index), buffer.get(index), context + " get " + index);
        }
        for (int index = expected.size(); index < snapshot.capacity(); index++) {
            equal(null, snapshot.slots().get(index), context + " unused slot " + index);
        }
    }

    private static void assertTraceMetadata(DynamicBuffer<?> buffer) {
        List<? extends DynamicBuffer.Step<?>> steps = buffer.steps();
        List<String> operations = buffer.operations();
        int previousOperation = -1;
        for (int index = 0; index < steps.size(); index++) {
            DynamicBuffer.Step<?> step = steps.get(index);
            equal(index, step.index(), "consecutive step indices");
            check(step.operationIndex() >= previousOperation && step.operationIndex() <= previousOperation + 1,
                    "operation indices progress without gaps");
            equal(operations.get(step.operationIndex()), step.operation(), "step operation description");
            equal(step.capacity(), step.slots().size(), "step retains all physical slots");
            check(step.sourceId() != null && !step.sourceId().isBlank(), "step has source mapping");
            for (int active : step.activeIndices()) check(active >= 0 && active < step.capacity(), "active slot in bounds");
            previousOperation = step.operationIndex();
        }
        if (!steps.isEmpty()) {
            DynamicBuffer.Step<?> last = steps.get(steps.size() - 1);
            equal("commit", last.phase(), "last step commits operation");
            equal(buffer.snapshot().slots(), last.slots(), "last trace matches current slots");
            equal(buffer.metrics(), last.metrics(), "last trace matches current metrics");
            equal(operations.size() - 1, last.operationIndex(), "last operation represented in trace");
        }
    }

    private static <E> void assertUnchanged(DynamicBuffer<E> buffer, Runnable action,
            Class<? extends Throwable> errorType, String context) {
        DynamicBuffer.Snapshot<E> before = buffer.snapshot();
        List<DynamicBuffer.Step<E>> steps = buffer.steps();
        List<String> operations = buffer.operations();
        if (errorType == null) action.run();
        else throwsType(errorType, action, context);
        equal(before, buffer.snapshot(), context + " leaves values, size, capacity and metrics unchanged");
        equal(steps, buffer.steps(), context + " leaves trace unchanged");
        equal(operations, buffer.operations(), context + " leaves operations unchanged");
    }

    private static int capacityFor(int size, DynamicBuffer.Growth growth) {
        int capacity = 4;
        while (capacity < size) capacity = nextCapacity(capacity, growth);
        return capacity;
    }

    private static int nextCapacity(int current, DynamicBuffer.Growth growth) {
        return Math.min(128, growth == DynamicBuffer.Growth.DOUBLE
                ? 2 * current : (3 * current + 1) / 2);
    }

    private static void throwsType(Class<? extends Throwable> expected, Runnable action, String context) {
        assertions++;
        try {
            action.run();
        } catch (Throwable actual) {
            if (expected.isInstance(actual)) return;
            throw new AssertionError(context + ": expected " + expected.getSimpleName()
                    + ", got " + actual.getClass().getSimpleName(), actual);
        }
        throw new AssertionError(context + ": expected " + expected.getSimpleName() + ", but nothing was thrown");
    }

    private static void equal(Object expected, Object actual, String context) {
        assertions++;
        if (!Objects.equals(expected, actual)) {
            throw new AssertionError(context + ": expected <" + expected + ">, got <" + actual + ">");
        }
    }

    private static void check(boolean condition, String context) {
        assertions++;
        if (!condition) throw new AssertionError(context);
    }
}
