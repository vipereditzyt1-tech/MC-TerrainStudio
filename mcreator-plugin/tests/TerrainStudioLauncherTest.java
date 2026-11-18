import net.terrainstudio.TerrainStudioLauncher;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Checks the install locations the plugin's Launch command searches, without starting anything. */
public final class TerrainStudioLauncherTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("terrain-studio-launcher");
        Path install = root.resolve("Programs").resolve("Terrain Studio");
        Files.createDirectories(install);
        Path executable = install.resolve("Terrain Studio.exe");
        Files.writeString(executable, "");

        Map<String, String> environment = new HashMap<>();
        environment.put("LOCALAPPDATA", root.toString());
        environment.put("ProgramFiles", root.resolve("missing").toString());

        List<Path> candidates = TerrainStudioLauncher.candidates(environment);
        expect(!candidates.isEmpty() && candidates.get(0).equals(install.resolve("Terrain Studio.exe")),
                "the per-user install is searched first");
        expect(executable.equals(TerrainStudioLauncher.locate(environment)), "an installed executable is found");
        expect(TerrainStudioLauncher.locate(Map.of()) == null, "with no environment and no override nothing is found");

        environment.put("TERRAIN_STUDIO_EXE", executable.toString());
        expect(executable.equals(TerrainStudioLauncher.locate(environment)), "TERRAIN_STUDIO_EXE overrides the search");

        environment.put("LOCALAPPDATA", root.resolve("empty").toString());
        expect(executable.equals(TerrainStudioLauncher.locate(environment)), "the override still wins when the default path is empty");

        System.out.println("PASS launcher finds per-user and overridden installs and reports nothing when absent");
    }

    private static void expect(boolean condition, String what) {
        if (condition) return;
        System.err.println("FAIL " + what);
        System.exit(1);
    }
}
