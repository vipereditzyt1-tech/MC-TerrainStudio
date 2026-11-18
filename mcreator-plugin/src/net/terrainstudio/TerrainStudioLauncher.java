package net.terrainstudio;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Finds the Terrain Studio editor for the plugin's **Launch Terrain Studio** command.
 *
 * The Windows installers put the app in one of three places (per-user NSIS/MSI installs use
 * `%LOCALAPPDATA%\Programs`, machine-wide installs use Program Files), so the candidates are tried in
 * order and the first real file wins. `TERRAIN_STUDIO_EXE` overrides the search, which is how a
 * development build or an unusual install location is pointed at.
 */
public final class TerrainStudioLauncher {
    private static final String EXECUTABLE = "Terrain Studio.exe";

    private TerrainStudioLauncher() { }

    public static List<Path> candidates(Map<String, String> environment) {
        List<Path> candidates = new ArrayList<>();
        String override = environment.get("TERRAIN_STUDIO_EXE");
        if (override != null && !override.isBlank()) candidates.add(Path.of(override));
        String localAppData = environment.get("LOCALAPPDATA");
        if (localAppData != null) candidates.add(Path.of(localAppData, "Programs", "Terrain Studio", EXECUTABLE));
        String programFiles = environment.get("ProgramFiles");
        if (programFiles != null) candidates.add(Path.of(programFiles, "Terrain Studio", EXECUTABLE));
        String programFilesX86 = environment.get("ProgramFiles(x86)");
        if (programFilesX86 != null) candidates.add(Path.of(programFilesX86, "Terrain Studio", EXECUTABLE));
        return candidates;
    }

    /** The first candidate that exists, or {@code null} when Terrain Studio is not installed. */
    public static Path locate(Map<String, String> environment) {
        for (Path candidate : candidates(environment)) {
            if (Files.isRegularFile(candidate)) return candidate;
        }
        return null;
    }

    /** Starts the editor. The caller reports failures; this only launches. */
    public static Process launch(Path executable) throws IOException {
        return new ProcessBuilder(executable.toString())
                .directory(executable.getParent().toFile())
                .start();
    }
}
