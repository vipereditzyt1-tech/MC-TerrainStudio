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
    /**
     * Called on the watcher thread for each package, after the package has been claimed. Returns
     * whether it was taken: `false` puts the package back so it is offered again later, which is how a
     * package sent while MCreator has no workspace open survives instead of being dropped.
     */
    public interface Receiver { boolean accept(Path packageFile); }

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

    /**
     * Offers whatever is queued right now. Called when a workspace window appears, because packages
     * that arrived while MCreator had no workspace were deliberately left in the folder.
     */
    public static void sweep(Path directory, Receiver receiver) {
        try {
            Path archive = directory.resolve("archive");
            Files.createDirectories(archive);
            deliverQueued(directory, archive, receiver);
        } catch (IOException error) {
            System.err.println("[Terrain Studio] could not scan " + directory + ": " + error.getMessage());
        }
    }

    private static void deliverQueued(Path directory, Path archive, Receiver receiver) throws IOException {
        try (Stream<Path> entries = Files.list(directory)) {
            for (Path entry : entries.sorted().toList()) deliver(entry, archive, receiver);
        }
    }

    private static void deliver(Path candidate, Path archive, Receiver receiver) {
        if (!isPackage(candidate)) return;
        Path claimed = null;
        try {
            // Moving first claims the package: a second event for the same path finds nothing to move.
            claimed = Files.move(candidate,
                    archive.resolve(System.currentTimeMillis() + "-" + candidate.getFileName()),
                    StandardCopyOption.REPLACE_EXISTING);
            if (receiver.accept(claimed)) return;
            // Nothing could take it yet; put it back where it was so the next workspace offers it.
            Files.move(claimed, candidate, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException | RuntimeException error) {
            System.err.println("[Terrain Studio] could not hand off " + candidate + ": " + error.getMessage());
        }
    }

    private static boolean isPackage(Path candidate) {
        return Files.isRegularFile(candidate)
                && candidate.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".tsmc");
    }
}
