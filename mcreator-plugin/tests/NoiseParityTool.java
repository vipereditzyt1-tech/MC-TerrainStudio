import net.terrainstudio.TerrainCompiler;
import java.nio.file.Files;
import java.nio.file.Path;

/** Test-only CLI: compile a .terrain project into a workspace-like directory for parity checks. */
public final class NoiseParityTool {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) throw new IllegalArgumentException("usage: <project> <outDir> <modId> <generator> <javaClass>");
        var output = TerrainCompiler.compile(Files.readString(Path.of(args[0])), args[2], args[3]);
        Path out = Path.of(args[1]);
        Files.createDirectories(out.resolve("src/main/java/net/terrainstudio/generated"));
        Files.writeString(out.resolve("src/main/java/net/terrainstudio/generated/TerrainStudioWorldgen.java"), output.source());
        for (var entry : output.settings().entrySet()) {
            Path target = out.resolve(entry.getKey());
            Files.createDirectories(target.getParent());
            Files.writeString(target, entry.getValue());
        }
        Files.writeString(out.resolve("compiled.java"), output.source());
        System.out.println("compiled " + output.source().length() + " bytes");
    }
}
