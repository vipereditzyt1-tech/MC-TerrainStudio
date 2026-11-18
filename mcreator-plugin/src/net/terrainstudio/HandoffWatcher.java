package net.terrainstudio;

import java.io.IOException;
import java.nio.file.ClosedWatchServiceException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.Locale;
import java.util.stream.Stream;

/**
 * Watches the hand-off folder Terrain Studio writes packages into, so the app can push a `.tsmc`
 * straight into a running MCreator instead of the user exporting a file and finding it in a chooser.
 *
 * The app writes each package beside its final name and renames it into place, so any visible
 * package is already complete. Packages found at startup were queued while MCreator was closed and
 * are delivered first. Every delivered package is moved into `archive/` before the receiver runs, so
 * an import is never offered twice — even if the receiver declines it.
 */
public final class HandoffWatcher {
    /** Called on the watcher thread for each package; the plugin hops to the UI thread itself. */
    public interface Receiver { void accept(Path packageFile); }

    private HandoffWatcher() { }

    /** The folder the desktop app writes to: `%USERPROFILE%\.terrainstudio\handoff`. */
    public static Path directory() {
        return Path.of(System.getProperty("user.home"), ".terrainstudio", "handoff");
    }

    /** Starts the watcher on a daemon thread, so a stuck watch can never keep MCreator open. */
    public static Thread start(Path directory, Receiver receiver) {
        Thread thread = new Thread(() -> watch(directory, receiver), "terrain-studio-handoff");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private static void watch(Path directory, Receiver receiver) {
        try {
            Files.createDirectories(directory);
            Path archive = directory.resolve("archive");
            Files.createDirectories(archive);
            deliverQueued(directory, archive, receiver);
            try (WatchService watcher = FileSystems.getDefault().newWatchService()) {
                directory.register(watcher, StandardWatchEventKinds.ENTRY_CREATE, StandardWatchEventKinds.ENTRY_MODIFY);
                while (true) {
                    WatchKey key = watcher.take();
                    for (WatchEvent<?> event : key.pollEvents()) {
                        if (event.kind() == StandardWatchEventKinds.OVERFLOW) continue;
                        deliver(directory.resolve((Path) event.context()), archive, receiver);
                    }
                    if (!key.reset()) return;
                }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (IOException | ClosedWatchServiceException stopped) {
            System.err.println("[Terrain Studio] package hand-off stopped: " + stopped.getMessage());
        }
    }

    private static void deliverQueued(Path directory, Path archive, Receiver receiver) throws IOException {
        try (Stream<Path> entries = Files.list(directory)) {
            for (Path entry : entries.sorted().toList()) deliver(entry, archive, receiver);
        }
    }

    private static void deliver(Path candidate, Path archive, Receiver receiver) {
        if (!isPackage(candidate)) return;
        try {
            // Moving first claims the package: a second event for the same path finds nothing to move.
            Path claimed = Files.move(candidate,
                    archive.resolve(System.currentTimeMillis() + "-" + candidate.getFileName()),
                    StandardCopyOption.REPLACE_EXISTING);
            receiver.accept(claimed);
        } catch (IOException | RuntimeException error) {
            System.err.println("[Terrain Studio] could not hand off " + candidate + ": " + error.getMessage());
        }
    }

    private static boolean isPackage(Path candidate) {
        return Files.isRegularFile(candidate)
                && candidate.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".tsmc");
    }
}
