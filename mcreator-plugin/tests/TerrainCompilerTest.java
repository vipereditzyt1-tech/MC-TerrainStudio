import net.terrainstudio.TerrainCompiler;
import net.terrainstudio.WorkspaceInstaller;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.*;

public class TerrainCompilerTest {
    private static final String DIR = "src/main/resources/data/minecraft/worldgen/noise_settings/";
    private static final String OVERWORLD = DIR + "overworld.json";
    private static final String LARGE_BIOMES = DIR + "large_biomes.json";
    private static final String AMPLIFIED = DIR + "amplified.json";
    private static final String PACKAGE = """
    {"format":"terrain-studio-minecraft","version":1,
     "generator":{"name":"Terrain Studio","version":"0.2.0"},
     "project":{"id":"abc123","name":"Highlands"},
     "target":{"generator":"neoforge-26.1.2","minecraft":"26.1.2","loader":"neoforge","loaderVersion":"26.1","java":21},
     "mode":"@MODE@",
     "dimension":{"id":"terrain_test:highlands","name":"Highlands","biomeSource":"vanilla","biome":"minecraft:plains"},
     "caves":"@CAVES@","surface":"@SURFACE@","performance":"balanced",
     "world":{"minY":@MIN@,"maxY":@MAX@,"seaLevel":63,"seed":@SEED@},
     "graph":{"nodes":[
       {"id":"c","data":{"kind":"coordinates","title":"Coordinates"}},
       {"id":"n","data":{"kind":"noise","title":"Noise","noiseType":"value","scale":0.01,"amplitude":0.8,"seed":100}},
       {"id":"o","data":{"kind":"output","title":"Output"}}],
      "edges":[{"id":"1","source":"c","target":"n"},{"id":"2","source":"n","target":"o"}]}}
    """;
    private static final String SHAPING = """
    {"format":"terrain-studio","version":1,"world":{"minY":-64,"maxY":319,"seaLevel":63},"graph":{"nodes":[
     {"id":"c","data":{"kind":"coordinates"}},
     {"id":"w","data":{"kind":"warp","scale":0.004,"strength":25,"seed":11,"rotation":15}},
     {"id":"n1","data":{"kind":"noise","noiseType":"perlin","scale":0.006,"amplitude":0.9,"seed":7,"rotation":30}},
     {"id":"n2","data":{"kind":"noise","noiseType":"ridged","scale":0.003,"amplitude":0.5,"seed":9}},
     {"id":"cl","data":{"kind":"clamp","min":0.1,"max":0.9}},
     {"id":"rm","data":{"kind":"remap","inMin":0.1,"inMax":0.9,"outMin":0,"outMax":1}},
     {"id":"cv","data":{"kind":"curve","gamma":1.4}},
     {"id":"bl","data":{"kind":"blend","factor":0.6}},
     {"id":"te","data":{"kind":"terrace","steps":6,"strength":0.7}},
     {"id":"er","data":{"kind":"erosion","scale":0.02,"strength":0.4,"seed":31}},
     {"id":"o","data":{"kind":"output"}}],"edges":[
      {"id":"1","source":"c","target":"w"},{"id":"2","source":"w","target":"n1"},
      {"id":"3","source":"c","target":"n2"},{"id":"4","source":"n1","target":"cl"},
      {"id":"5","source":"cl","target":"rm"},{"id":"6","source":"rm","target":"cv"},
      {"id":"7","source":"cv","target":"bl"},{"id":"8","source":"n2","target":"bl"},
      {"id":"9","source":"bl","target":"te"},{"id":"10","source":"te","target":"er"},
      {"id":"11","source":"er","target":"o"}]}}
    """;
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void rejects(Runnable r, String message) { try { r.run(); throw new AssertionError(message); } catch (IllegalArgumentException expected) {} }
    private static String selfCompile(String project, String generator) {
        try { return TerrainCompiler.compile(project, "terrain_test", generator).source(); }
        catch (java.io.IOException e) { throw new RuntimeException(e); }
    }
    private static TerrainCompiler.Output compilePackage(String mode, String caves, String surface, String min, String max, String seed) throws Exception {
        String text = PACKAGE.replace("@MODE@", mode).replace("@CAVES@", caves).replace("@SURFACE@", surface)
                .replace("@MIN@", min).replace("@MAX@", max).replace("@SEED@", seed);
        return TerrainCompiler.compile(text, "terrain_test", "neoforge-26.1.2");
    }

    public static void main(String[] args) throws Exception {
        String project = """
        {"format":"terrain-studio","version":1,"world":{"minY":-64,"maxY":319,"seaLevel":63},"graph":{"nodes":[
        {"id":"c","data":{"kind":"coordinates"}},
        {"id":"a","data":{"kind":"noise","noiseType":"value","scale":0.0015,"amplitude":0.55,"seed":101}},
        {"id":"b","data":{"kind":"noise","noiseType":"ridged","scale":0.008,"amplitude":0.35,"seed":7}},
        {"id":"m","data":{"kind":"add"}}, {"id":"o","data":{"kind":"output"}}],"edges":[
        {"id":"1","source":"c","target":"a"},{"id":"2","source":"c","target":"b"},
        {"id":"3","source":"a","target":"m"},{"id":"4","source":"b","target":"m"},
        {"id":"5","source":"m","target":"o"}]}}
        """;
        var one = TerrainCompiler.compile(project, "terrain_test", "neoforge-1.21.1");
        var two = TerrainCompiler.compile(project, "terrain_test", "neoforge-26.1.2");
        check(one.source().contains("ResourceLocation.fromNamespaceAndPath"), "1.21.1 identifier");
        check(two.source().contains("Identifier.fromNamespaceAndPath"), "26.1 identifier");
        check(one.settings().keySet().equals(java.util.Set.of(OVERWORLD, LARGE_BIOMES, AMPLIFIED)), "every natural overworld preset is covered");
        for (String preset : new String[] { OVERWORLD, LARGE_BIOMES, AMPLIFIED }) {
            var router = JsonParser.parseString(one.settings().get(preset)).getAsJsonObject().getAsJsonObject("noise_router");
            check(router.getAsJsonObject("final_density").getAsJsonObject("argument1").get("type").getAsString().equals("terrain_test:terrain_studio_height"), "density registered in " + preset);
            check(!router.has("initial_density_without_jaggedness") || router.getAsJsonObject("initial_density_without_jaggedness").getAsJsonObject("argument1").get("type").getAsString().equals("terrain_test:terrain_studio_height"), "surface density registered in " + preset);
        }
        var router26 = JsonParser.parseString(two.settings().get(OVERWORLD)).getAsJsonObject().getAsJsonObject("noise_router");
        check(router26.getAsJsonObject("preliminary_surface_level").get("type").getAsString().equals("terrain_test:terrain_studio_height"), "26.1 uses graph for preliminary surface");
        check(!router26.has("initial_density_without_jaggedness"), "26.1 does not receive obsolete router field");
        for (String noise : java.util.List.of("perlin", "simplex", "cellular", "minecraft-erosion", "minecraft-weirdness", "minecraft-temperature")) {
            var compiled = TerrainCompiler.compile(project.replace("\"value\"", "\"" + noise + "\""), "terrain_test", "neoforge-26.1.2");
            String expectedCall = noise.equals("cellular") ? "cellular(" : noise.equals("perlin") || noise.equals("simplex") ? "gradientFractal(" : "fractal(";
            check(compiled.source().contains(expectedCall), "supports " + noise);
        }

        // Every shaping node reaches the generated Java, including domain warp and erosion.
        String shaping = selfCompile(SHAPING, "neoforge-1.21.1");
        for (String marker : new String[] { "Math.pow(", "Math.floor(", "Math.cos(", "erode(" }) {
            check(shaping.contains(marker), "shaping graph emits " + marker);
        }

        // Custom dimension mode.
        var dimension = compilePackage("dimension", "none", "vanilla", "0", "255", "5");
        check(dimension.mode().equals("dimension"), "dimension mode");
        String settings = "src/main/resources/data/terrain_test/worldgen/noise_settings/highlands.json";
        String type = "src/main/resources/data/terrain_test/dimension_type/highlands.json";
        String dimensionFile = "src/main/resources/data/terrain_test/dimension/highlands.json";
        check(dimension.files().containsKey(settings), "dimension noise settings");
        check(dimension.files().containsKey(type), "dimension type");
        check(dimension.files().containsKey(dimensionFile), "dimension");
        JsonObject dimensionJson = JsonParser.parseString(dimension.files().get(dimensionFile)).getAsJsonObject();
        check(dimensionJson.get("type").getAsString().equals("terrain_test:highlands"), "dimension type id");
        check(dimensionJson.getAsJsonObject("generator").get("settings").getAsString().equals("terrain_test:highlands"), "dimension settings id");
        JsonObject dimensionType = JsonParser.parseString(dimension.files().get(type)).getAsJsonObject();
        check(dimensionType.get("min_y").getAsInt() == 0 && dimensionType.get("height").getAsInt() == 256, "dimension height range");
        check(dimensionType.get("logical_height").getAsInt() == 256, "logical height");
        check(dimension.source().contains("105"), "package seed offset");
        JsonObject dimensionRouter = JsonParser.parseString(dimension.files().get(settings)).getAsJsonObject().getAsJsonObject("noise_router");
        check(dimensionRouter.getAsJsonObject("final_density").getAsJsonObject("argument1").get("type").getAsString().equals("terrain_test:terrain_studio_height"), "dimension router");

        // World preset mode.
        var preset = compilePackage("preset", "none", "vanilla", "-64", "319", "0");
        String presetFile = "src/main/resources/data/terrain_test/worldgen/world_preset/highlands.json";
        check(preset.files().containsKey(presetFile), "world preset");
        JsonObject presetJson = JsonParser.parseString(preset.files().get(presetFile)).getAsJsonObject();
        check(presetJson.getAsJsonObject("dimensions").has("minecraft:overworld"), "preset maps overworld");

        // Preservation controls change real router entries.
        var caves = compilePackage("dimension", "vanilla-approximate", "vanilla", "0", "255", "0");
        JsonObject caveRouter = JsonParser.parseString(caves.files().get(settings)).getAsJsonObject().getAsJsonObject("noise_router");
        check(caveRouter.getAsJsonObject("sloped_cheese").getAsJsonObject("argument1").get("type").getAsString().equals("terrain_test:terrain_studio_height"), "caves redirect sloped_cheese");
        check(!caveRouter.getAsJsonObject("final_density").getAsJsonObject("argument1").get("type").getAsString().equals("terrain_test:terrain_studio_height"), "caves keep vanilla final_density");

        var surface = compilePackage("dimension", "none", "terrain-studio", "0", "255", "0");
        JsonObject surfaceSettings = JsonParser.parseString(surface.files().get(settings)).getAsJsonObject();
        check(surfaceSettings.getAsJsonObject("surface_rule").get("type").getAsString().equals("minecraft:sequence"), "surface rules generated");

        // Validation.
        rejects(() -> { try { TerrainCompiler.compile(project.replace("\"value\"", "\"not-a-noise\""), "terrain_test", "neoforge-1.21.1"); } catch (java.io.IOException e) { throw new RuntimeException(e); } }, "unsupported noise");
        rejects(() -> { try { TerrainCompiler.compile(project, "terrain_test", "fabric-1.21.1"); } catch (java.io.IOException e) { throw new RuntimeException(e); } }, "unsupported generator");
        rejects(() -> { try { TerrainCompiler.compile(project.replace("\"minY\":-64", "\"minY\":-32"), "terrain_test", "neoforge-1.21.1"); } catch (java.io.IOException e) { throw new RuntimeException(e); } }, "invalid world height");
        rejects(() -> { try { TerrainCompiler.compile(project.replace("\"source\":\"m\",\"target\":\"o\"", "\"source\":\"m\",\"target\":\"m\""), "terrain_test", "neoforge-1.21.1"); } catch (java.io.IOException e) { throw new RuntimeException(e); } }, "cycle");
        rejects(() -> { try { compilePackage("dimension", "none", "vanilla", "1", "256", "0"); } catch (Exception e) { if (e instanceof IllegalArgumentException) throw (IllegalArgumentException) e; throw new RuntimeException(e); } }, "unaligned dimension bounds");
        rejects(() -> { try { TerrainCompiler.compile(PACKAGE.replace("@MODE@", "dimension").replace("@CAVES@", "none").replace("@SURFACE@", "vanilla").replace("@MIN@", "0").replace("@MAX@", "255").replace("@SEED@", "0").replace("terrain_test:highlands", "Bad:Id"), "terrain_test", "neoforge-26.1.2"); } catch (java.io.IOException e) { throw new RuntimeException(e); } }, "invalid dimension id");

        // Installer: ownership, backup and rollback.
        Path root = Path.of(args[0]); Files.createDirectories(root);
        WorkspaceInstaller.install(root, one);
        Path source = root.resolve("src/main/java/net/terrainstudio/generated/TerrainStudioWorldgen.java");
        Path resource = root.resolve(OVERWORLD);
        check(Files.readString(source).equals(one.source()) && Files.readString(resource).equals(one.settings().get(OVERWORLD)), "installation");
        check(Files.readString(root.resolve(AMPLIFIED)).equals(one.settings().get(AMPLIFIED)), "amplified installation");
        JsonObject manifest = JsonParser.parseString(Files.readString(root.resolve(".terrain-studio/installed.json"))).getAsJsonObject();
        check(manifest.get("version").getAsInt() == 2, "manifest version 2");
        check(manifest.has("files"), "manifest tracks files");

        WorkspaceInstaller.install(root, two);
        check(Files.readString(source).equals(two.source()), "owned update");
        check(Files.readString(root.resolve(LARGE_BIOMES)).equals(two.settings().get(LARGE_BIOMES)), "owned preset update");
        JsonObject updated = JsonParser.parseString(Files.readString(root.resolve(".terrain-studio/installed.json"))).getAsJsonObject();
        check(updated.has("backup"), "backup recorded");
        Path backup = root.resolve(updated.get("backup").getAsString());
        check(Files.exists(backup.resolve(OVERWORLD)), "previous noise settings backed up");

        int restored = WorkspaceInstaller.rollback(root);
        check(restored > 0, "rollback restored files");
        check(Files.readString(source).equals(one.source()), "rollback restores source");
        check(!Files.exists(root.resolve(".terrain-studio/installed.json")), "rollback clears manifest");

        Files.writeString(resource, "user edits");
        try { WorkspaceInstaller.install(root, one); throw new AssertionError("conflict not rejected"); }
        catch (java.io.IOException expected) { check(expected.getMessage().contains("Conflict"), "conflict reason"); }
        check(Files.readString(resource).equals("user edits"), "conflict preserves user file");

        Files.writeString(root.resolve("compiled-1.21.1.java"), one.source());
        Files.writeString(root.resolve("compiled-26.1.2.java"), two.source());
        for (var entry : one.settings().entrySet()) Files.writeString(root.resolve("compiled-1.21.1-" + Path.of(entry.getKey()).getFileName()), entry.getValue());
        for (var entry : two.settings().entrySet()) Files.writeString(root.resolve("compiled-26.1.2-" + Path.of(entry.getKey()).getFileName()), entry.getValue());
        System.out.println("PASS overworld/dimension/preset compilation, shaping nodes, validation, backups and rollback");
    }
}
