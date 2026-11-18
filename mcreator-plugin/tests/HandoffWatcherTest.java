import net.terrainstudio.HandoffWatcher;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

/**
 * Exercises the folder the desktop app writes packages into, without MCreator's UI: what arrives,
 * what is ignored, and that a delivered package can never be imported twice.
 */
public final class HandoffWatcherTest {
    public static void main(String[] args) throws Exception {
        Path queuedRoot = Files.createTempDirectory("terrain-studio-handoff-queued");
        Path queuedDirectory = queuedRoot.resolve("handoff");
        Files.createDirectories(queuedDirectory);
        Path queued = queuedDirectory.resolve("queued.tsmc");
        Files.writeString(queued, "{}", StandardCharsets.UTF_8);

        CountDownLatch startup = new CountDownLatch(1);
        AtomicReference<Path> startupDelivered = new AtomicReference<>();
        HandoffWatcher.start(queuedDirectory, file -> {
            startupDelivered.set(file);
            startup.countDown();
            return true;
        });

        expect(startup.await(15, TimeUnit.SECONDS), "a package queued while MCreator was closed is delivered on startup");
        expect(Files.readString(startupDelivered.get(), StandardCharsets.UTF_8).equals("{}"), "the queued package arrives intact");
        expect(!Files.exists(queued), "a delivered package is moved out of the hand-off folder");
        expect(startupDelivered.get().getParent().getFileName().toString().equals("archive"), "the delivered package is kept in archive/");

        Path liveRoot = Files.createTempDirectory("terrain-studio-handoff-live");
        Path liveDirectory = liveRoot.resolve("handoff");
        Files.createDirectories(liveDirectory);
        CountDownLatch live = new CountDownLatch(1);
        AtomicReference<Path> liveDelivered = new AtomicReference<>();
        HandoffWatcher.start(liveDirectory, file -> {
            liveDelivered.set(file);
            live.countDown();
            return true;
        });

        // The app writes beside the final name and renames, exactly as this does.
        Path partial = liveDirectory.resolve("incoming.tsmc.part");
        Files.writeString(partial, "{\"version\":1}", StandardCharsets.UTF_8);
        Files.move(partial, liveDirectory.resolve("incoming.tsmc"), StandardCopyOption.ATOMIC_MOVE);

        expect(live.await(15, TimeUnit.SECONDS), "a package written while MCreator is open is delivered");
        expect(Files.readString(liveDelivered.get(), StandardCharsets.UTF_8).equals("{\"version\":1}"), "the live package arrives intact");

        Path otherRoot = Files.createTempDirectory("terrain-studio-handoff-ignored");
        Path otherDirectory = otherRoot.resolve("handoff");
        Files.createDirectories(otherDirectory);
        CountDownLatch ignored = new CountDownLatch(1);
        HandoffWatcher.start(otherDirectory, file -> {
            ignored.countDown();
            return true;
        });
        Files.writeString(otherDirectory.resolve("notes.txt"), "not a package", StandardCharsets.UTF_8);
        expect(!ignored.await(2, TimeUnit.SECONDS), "other files in the folder are ignored");

        // A declined package must stay queued: that is what happens while MCreator has no workspace.
        Path deferredRoot = Files.createTempDirectory("terrain-studio-handoff-deferred");
        Path deferredDirectory = deferredRoot.resolve("handoff");
        Files.createDirectories(deferredDirectory);
        CountDownLatch declined = new CountDownLatch(1);
        HandoffWatcher.start(deferredDirectory, file -> {
            declined.countDown();
            return false;
        });
        Path deferred = deferredDirectory.resolve("waiting.tsmc");
        Files.writeString(deferred, "{}", StandardCharsets.UTF_8);
        expect(declined.await(15, TimeUnit.SECONDS), "a declined package is offered to the receiver");
        // The receiver returns before the watcher moves the file back, so wait for it rather than
        // racing the move.
        expect(waitsFor(() -> Files.exists(deferred), 10), "a declined package is put back and stays queued");

        // Opening a workspace later must find it again.
        CountDownLatch swept = new CountDownLatch(1);
        AtomicReference<Path> sweptFile = new AtomicReference<>();
        HandoffWatcher.sweep(deferredDirectory, file -> {
            sweptFile.set(file);
            swept.countDown();
            return true;
        });
        expect(swept.await(5, TimeUnit.SECONDS), "a later sweep delivers the deferred package");
        expect(Files.readString(sweptFile.get(), StandardCharsets.UTF_8).equals("{}"), "the deferred package arrives intact");

        System.out.println("PASS hand-off delivers queued and live packages, defers when nothing can take them, archives and ignores the rest");
        delete(queuedRoot);
        delete(liveRoot);
        delete(otherRoot);
        delete(deferredRoot);
    }

    private static boolean waitsFor(Check condition, int seconds) throws InterruptedException {
        long deadline = System.nanoTime() + seconds * 1_000_000_000L;
        while (System.nanoTime() < deadline) {
            try {
                if (condition.test()) return true;
            } catch (Exception ignored) {
                // The file may be mid-move; keep waiting.
            }
            Thread.sleep(25);
        }
        return false;
    }

    private interface Check { boolean test() throws Exception; }

    private static void expect(boolean condition, String what) {
        if (condition) return;
        System.err.println("FAIL " + what);
        System.exit(1);
    }

    private static void delete(Path root) throws Exception {
        try (Stream<Path> entries = Files.walk(root)) {
            for (Path entry : entries.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(entry);
        }
    }
}
