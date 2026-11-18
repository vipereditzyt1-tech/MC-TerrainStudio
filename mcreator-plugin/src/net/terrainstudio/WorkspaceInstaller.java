package net.terrainstudio;

import com.google.gson.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

/**
 * Installs only plugin-owned files. Every run backs up the files it replaces, records SHA-256
 * hashes in .terrain-studio/installed.json, and refuses to overwrite anything edited outside
 * Terrain Studio. A failed install restores the previous bytes; {@link #rollback(Path)} restores
 * the previous import on demand.
 */
public final class WorkspaceInstaller {
    public static final String MANIFEST = ".terrain-studio/installed.json";
    public static final String BACKUP_ROOT = ".terrain-studio/backups/";
    private static final List<String> ALLOWED_PREFIXES = List.of(
            "src/main/java/net/terrainstudio/generated/",
            "src/main/resources/data/");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private WorkspaceInstaller() {}

    private static String hash(byte[] data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static Path secure(Path root, String relative) throws IOException {
        Path target = root.resolve(relative).normalize();
        if (!target.startsWith(root)) throw new IOException("Path escapes workspace: " + relative);
        Path current = root;
        for (Path part : root.relativize(target)) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw new IOException("Symbolic link in installation path: " + current);
        }
        return target;
    }
    private static void atomicWrite(Path target, byte[] data) throws IOException {
        Files.createDirectories(target.getParent());
        Path temporary = Files.createTempFile(target.getParent(), ".terrain-studio-", ".tmp");
        try {
            Files.write(temporary, data);
            try { Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException e) { Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING); }
        } finally { Files.deleteIfExists(temporary); }
    }

    private record Manifest(int version, Map<String, String> files, String backup, Set<String> created) {}

    private static Manifest readManifest(Path manifest) throws IOException {
        Map<String, String> owned = new LinkedHashMap<>();
        Set<String> created = new LinkedHashSet<>();
        if (!Files.exists(manifest)) return new Manifest(0, owned, null, created);
        if (!Files.isRegularFile(manifest) || Files.size(manifest) > 65536)
            throw new IOException("Invalid Terrain Studio ownership record.");
        try {
            JsonObject data = JsonParser.parseString(Files.readString(manifest)).getAsJsonObject();
            if (!data.has("version")) throw new IOException("Unsupported Terrain Studio ownership record.");
            int version = data.get("version").getAsInt();
            if (version != 1 && version != 2) throw new IOException("Unsupported Terrain Studio ownership record.");
            JsonObject files = data.getAsJsonObject("files");
            for (String key : files.keySet()) owned.put(key, files.get(key).getAsString());
            String backup = data.has("backup") ? data.get("backup").getAsString() : null;
            if (version == 2 && data.has("created")) {
                for (JsonElement entry : data.getAsJsonArray("created")) created.add(entry.getAsString());
            }
            return new Manifest(version, owned, backup, created);
        } catch (RuntimeException e) {
            throw new IOException("Invalid Terrain Studio ownership record.", e);
        }
    }

    private static String checkManagedPath(String relative) throws IOException {
        if (!ALLOWED_PREFIXES.stream().anyMatch(relative::startsWith) || relative.contains(".."))
            throw new IOException("Refusing to write outside Terrain Studio's generated directories: " + relative);
        if (!(relative.endsWith(".java") || relative.endsWith(".json")))
            throw new IOException("Refusing to write an unexpected file type: " + relative);
        return relative;
    }

    public static void install(Path workspace, TerrainCompiler.Output generated) throws IOException {
        Path root = workspace.toRealPath();
        Path manifestPath = secure(root, MANIFEST);
        Manifest previousManifest = readManifest(manifestPath);
        Map<String, String> owned = previousManifest.files();

        Map<String, byte[]> writes = new LinkedHashMap<>();
        writes.put(TerrainCompiler.SOURCE, generated.source().getBytes(StandardCharsets.UTF_8));
        for (var entry : generated.files().entrySet()) {
            String relative = checkManagedPath(entry.getKey());
            writes.put(relative, entry.getValue().getBytes(StandardCharsets.UTF_8));
        }

        Map<Path, byte[]> previous = new LinkedHashMap<>();
        Set<String> created = new LinkedHashSet<>();
        for (var entry : writes.entrySet()) {
            Path path = secure(root, entry.getKey());
            byte[] old = null;
            if (Files.exists(path)) {
                if (!Files.isRegularFile(path) || Files.size(path) > 8 * 1024 * 1024)
                    throw new IOException("Invalid existing file: " + path);
                old = Files.readAllBytes(path);
                if (!hash(old).equals(owned.get(entry.getKey())))
                    throw new IOException("Conflict: " + entry.getKey() + " exists or was edited outside Terrain Studio. Nothing was changed.");
            } else {
                created.add(entry.getKey());
            }
            previous.put(path, old);
        }

        // Back up every file that is about to change, before the first byte is written.
        String backupRelative = null;
        if (previous.values().stream().anyMatch(Objects::nonNull)) {
            String stamp = Long.toString(System.currentTimeMillis());
            backupRelative = BACKUP_ROOT + stamp + "/";
            for (var entry : previous.entrySet()) {
                if (entry.getValue() == null) continue;
                Path backup = secure(root, backupRelative + root.relativize(entry.getKey()));
                atomicWrite(backup, entry.getValue());
            }
        }

        List<Path> applied = new ArrayList<>();
        try {
            for (var entry : writes.entrySet()) {
                Path path = secure(root, entry.getKey());
                atomicWrite(path, entry.getValue()); applied.add(path);
            }
            JsonObject hashes = new JsonObject();
            for (var entry : writes.entrySet()) hashes.addProperty(entry.getKey(), hash(entry.getValue()));
            JsonArray createdArray = new JsonArray();
            created.forEach(createdArray::add);
            JsonObject record = new JsonObject();
            record.addProperty("version", 2);
            record.addProperty("generatorVersion", generated.generatorVersion());
            record.addProperty("projectId", generated.projectId());
            record.addProperty("mode", generated.mode());
            if (backupRelative != null) record.addProperty("backup", backupRelative);
            record.add("created", createdArray);
            record.add("files", hashes);
            atomicWrite(manifestPath, (GSON.toJson(record) + "\n").getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            for (int index = applied.size() - 1; index >= 0; index--) {
                Path path = applied.get(index); byte[] old = previous.get(path);
                try { if (old == null) Files.deleteIfExists(path); else atomicWrite(path, old); }
                catch (IOException rollback) { e.addSuppressed(rollback); }
            }
            if (!previousManifest.files().isEmpty()) {
                try { atomicWrite(manifestPath, Files.readAllBytes(manifestPath)); } catch (IOException ignored) {}
            }
            throw e;
        }
    }

    /** Restore the files from the previous successful import and delete the ones that import created. */
    public static int rollback(Path workspace) throws IOException {
        Path root = workspace.toRealPath();
        Path manifestPath = secure(root, MANIFEST);
        Manifest manifest = readManifest(manifestPath);
        if (manifest.version() != 2 || manifest.backup() == null)
            throw new IOException("There is no Terrain Studio import with a backup to roll back.");
        if (!manifest.backup().startsWith(BACKUP_ROOT) || manifest.backup().contains(".."))
            throw new IOException("Invalid Terrain Studio backup record.");
        int restored = 0;
        for (String relative : manifest.files().keySet()) {
            checkManagedPath(relative);
            Path target = secure(root, relative);
            Path backup = secure(root, manifest.backup() + relative);
            if (Files.isRegularFile(backup)) {
                atomicWrite(target, Files.readAllBytes(backup));
                restored++;
            } else if (manifest.created().contains(relative)) {
                Files.deleteIfExists(target);
                restored++;
            }
        }
        Files.deleteIfExists(manifestPath);
        return restored;
    }
}
