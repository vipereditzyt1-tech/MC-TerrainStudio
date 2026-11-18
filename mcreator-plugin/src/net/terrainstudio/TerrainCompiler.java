package net.terrainstudio;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Compiles a Terrain Studio graph into a NeoForge density function plus the world-generation
 * resources for one of three modes: Overworld replacement, custom dimension, or world preset.
 *
 * <p>Every arithmetic branch mirrors {@code src/terrainEngine.ts}. That is the contract that keeps
 * the editor preview and the generated Minecraft terrain identical.</p>
 */
public final class TerrainCompiler {
    public static final String SOURCE = "src/main/java/net/terrainstudio/generated/TerrainStudioWorldgen.java";
    public static final String GENERATOR_VERSION = "0.2.0";
    private static final String MINECRAFT_SETTINGS = "src/main/resources/data/minecraft/worldgen/noise_settings/";
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static final Set<String> KINDS = Set.of(
            "coordinates", "noise", "add", "multiply", "output",
            "clamp", "remap", "curve", "blend", "terrace", "warp", "erosion",
            "min", "max", "subtract", "divide", "power", "abs", "invert",
            "smoothstep", "threshold", "offset", "ridge", "sine", "triangle",
            "quantize", "contrast", "radial", "swirl");
    private static final Set<String> AT_LEAST_ONE = Set.of("add", "multiply", "min", "max");
    private static final Set<String> EXACTLY_TWO = Set.of("blend", "subtract", "divide");
    private static final Set<String> NOISE_TYPES = Set.of("value", "ridged", "perlin", "simplex", "cellular", "wave",
            "minecraft-continentalness", "minecraft-erosion", "minecraft-weirdness", "minecraft-temperature");
    private static final Set<String> GENERATORS = Set.of("neoforge-1.21.1", "neoforge-26.1.2");

    /** Generated source plus every workspace-relative file the plugin owns. */
    public record Output(String source, Map<String, String> files, List<String> warnings,
                         String mode, String projectId, String generatorVersion, String generator) {
        public Output {
            files = Collections.unmodifiableMap(new LinkedHashMap<>(files));
            warnings = List.copyOf(warnings);
        }
        /** Noise-settings files only, retained for the Overworld tests and older callers. */
        public Map<String, String> settings() {
            Map<String, String> settings = new LinkedHashMap<>();
            for (var entry : files.entrySet()) {
                if (entry.getKey().contains("/worldgen/noise_settings/")) settings.put(entry.getKey(), entry.getValue());
            }
            return settings;
        }
    }

    private record GraphNode(String id, String kind, JsonObject data) {}
    private record Coord(String x, String z) {}
    private record Package(boolean modern, String generator, String mode, String projectId, String dimensionId,
                           String dimensionName, String biomeSource, String biome, String caves, String surface,
                           String performance, double minY, double maxY, double seaLevel, int seed,
                           int logicalHeight, double coordinateScale, double ambientLight,
                           boolean hasSkylight, boolean hasCeiling) {}

    private TerrainCompiler() {}

    private static String resource(String name) throws IOException {
        try (InputStream stream = TerrainCompiler.class.getResourceAsStream(name)) {
            if (stream == null) throw new IOException("Plugin resource missing: " + name);
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
    private static String str(JsonObject object, String key) {
        if (!object.has(key) || !object.get(key).isJsonPrimitive() || !object.get(key).getAsJsonPrimitive().isString())
            throw new IllegalArgumentException("Missing text field: " + key);
        return object.get(key).getAsString();
    }
    private static String optionalStr(JsonObject object, String key, String fallback) {
        return object.has(key) && object.get(key).isJsonPrimitive() && object.get(key).getAsJsonPrimitive().isString()
                ? object.get(key).getAsString() : fallback;
    }
    private static double number(JsonObject object, String key) {
        if (!object.has(key) || !object.get(key).isJsonPrimitive() || !object.get(key).getAsJsonPrimitive().isNumber())
            throw new IllegalArgumentException("Missing numeric field: " + key);
        double value = object.get(key).getAsDouble();
        if (!Double.isFinite(value)) throw new IllegalArgumentException("Invalid number: " + key);
        return value;
    }
    private static double number(JsonObject object, String key, double fallback) {
        if (!object.has(key) || object.get(key).isJsonNull()) return fallback;
        if (!object.get(key).isJsonPrimitive() || !object.get(key).getAsJsonPrimitive().isNumber())
            throw new IllegalArgumentException("Invalid numeric field: " + key);
        double value = object.get(key).getAsDouble();
        if (!Double.isFinite(value)) throw new IllegalArgumentException("Invalid number: " + key);
        return value;
    }
    private static int whole(JsonObject object, String key, int fallback) {
        double value = number(object, key, fallback);
        if (value != Math.rint(value) || value < Integer.MIN_VALUE || value > Integer.MAX_VALUE)
            throw new IllegalArgumentException(key + " must be a whole number in the 32-bit integer range.");
        return (int) value;
    }
    private static JsonObject obj(JsonObject object, String key) {
        if (!object.has(key) || !object.get(key).isJsonObject()) throw new IllegalArgumentException("Missing object: " + key);
        return object.getAsJsonObject(key);
    }
    private static JsonArray array(JsonObject object, String key) {
        if (!object.has(key) || !object.get(key).isJsonArray()) throw new IllegalArgumentException("Missing array: " + key);
        return object.getAsJsonArray(key);
    }
    private static String decimal(double value) {
        if (!Double.isFinite(value)) throw new IllegalArgumentException("Non-finite number");
        return Double.toString(value);
    }
    private static String clamp01(String expression) {
        return "Math.max(0.0, Math.min(1.0, " + expression + "))";
    }

    public static Output compile(String text, String modId, String generator) throws IOException {
        if (text.length() > 20 * 1024 * 1024) throw new IllegalArgumentException("Project exceeds 20 MB.");
        if (!modId.matches("[a-z][a-z0-9_]{1,63}")) throw new IllegalArgumentException("Invalid mod ID.");
        JsonObject root = JsonParser.parseString(text).getAsJsonObject();
        Package config = readPackage(root, generator);
        if (!GENERATORS.contains(config.generator()))
            throw new IllegalArgumentException("Unsupported generator: " + config.generator() + ". Use NeoForge 1.21.1 or 26.1.2.");
        String version = switch (config.generator()) {
            case "neoforge-1.21.1" -> "1.21.1";
            case "neoforge-26.1.2" -> "26.1.2";
            default -> throw new IllegalArgumentException("Unsupported generator: " + config.generator());
        };
        validateWorld(config);
        JsonObject graph = obj(root, "graph");
        JsonArray nodes = array(graph, "nodes"), edges = array(graph, "edges");
        if (nodes.size() > 512 || edges.size() > 4096) throw new IllegalArgumentException("Graph exceeds integration limits.");

        LinkedHashMap<String, GraphNode> byId = new LinkedHashMap<>();
        String output = null;
        for (JsonElement entry : nodes) {
            if (!entry.isJsonObject()) throw new IllegalArgumentException("Invalid node.");
            JsonObject node = entry.getAsJsonObject(), data = obj(node, "data");
            String id = str(node, "id"), kind = str(data, "kind");
            if (id.isBlank() || !KINDS.contains(kind) || byId.putIfAbsent(id, new GraphNode(id, kind, data)) != null)
                throw new IllegalArgumentException("Invalid or duplicate graph node: " + id);
            validateNode(new GraphNode(id, kind, data));
            if (kind.equals("output")) {
                if (output != null) throw new IllegalArgumentException("Graph requires exactly one output.");
                output = id;
            }
        }
        if (output == null) throw new IllegalArgumentException("Graph requires exactly one output. Connect a Terrain Output node before exporting.");

        Map<String, List<String>> incoming = new HashMap<>();
        Set<String> edgeIds = new HashSet<>(), pairs = new HashSet<>();
        for (JsonElement entry : edges) {
            if (!entry.isJsonObject()) throw new IllegalArgumentException("Invalid edge.");
            JsonObject e = entry.getAsJsonObject();
            String id = str(e, "id"), from = str(e, "source"), to = str(e, "target");
            GraphNode a = byId.get(from), b = byId.get(to);
            if (id.isBlank() || !edgeIds.add(id) || !pairs.add(from + ":" + to + ":" + from) || a == null || b == null)
                throw new IllegalArgumentException("Invalid or duplicate graph connection.");
            String sourceType = outputType(a.kind()), expected = expectedType(b.kind());
            if (sourceType == null || expected == null || !sourceType.equals(expected))
                throw new IllegalArgumentException("Incompatible graph connection: " + a.kind() + " → " + b.kind() + ".");
            incoming.computeIfAbsent(to, key -> new ArrayList<>()).add(from);
        }

        Set<String> active = new HashSet<>(), done = new HashSet<>();
        List<String> allOrder = new ArrayList<>();
        for (String id : byId.keySet()) visit(id, incoming, active, done, allOrder);

        active.clear(); done.clear();
        List<String> order = new ArrayList<>();
        visit(output, incoming, active, done, order);
        if (order.size() > 256) throw new IllegalArgumentException("Output graph exceeds 256 nodes.");

        CompiledGraph compiled = emitGraph(order, byId, incoming, incoming.getOrDefault(output, List.of()), config.seed());
        String source = resource("/templates/TerrainStudioWorldgen.java.template")
                .replace("@PACKAGE@", "net.terrainstudio.generated")
                .replace("@IDCLASS@", version.equals("1.21.1") ? "ResourceLocation" : "Identifier")
                .replace("@MODID@", modId)
                .replace("@MINY@", decimal(config.minY()))
                .replace("@MAXY@", decimal(config.maxY()))
                .replace("@GRAPH@", compiled.statements())
                .replace("@OUTPUT@", compiled.output());

        JsonObject height = new JsonObject();
        height.addProperty("type", modId + ":terrain_studio_height");
        JsonObject y = new JsonObject();
        y.addProperty("type", "minecraft:y_clamped_gradient");
        y.addProperty("from_y", (int) config.minY());
        y.addProperty("to_y", (int) config.maxY() + 1);
        y.addProperty("from_value", -config.minY());
        y.addProperty("to_value", -(config.maxY() + 1));
        JsonObject density = new JsonObject();
        density.addProperty("type", "minecraft:add");
        density.add("argument1", height);
        density.add("argument2", y);

        LinkedHashMap<String, String> files = new LinkedHashMap<>();
        files.put(SOURCE, source);
        List<String> warnings = new ArrayList<>();
        if (config.caves().equals("vanilla-approximate"))
            warnings.add("Vanilla caves are preserved through the vanilla density router; surfaces can drift up to about 7 blocks from the preview.");
        else if (config.biomeSource().equals("vanilla"))
            warnings.add("No density caves still leaves vanilla biome carvers, which can cut the surface. Use a fixed carver-free biome such as minecraft:the_void for exact heights.");

        if (config.mode().equals("overworld")) {
            for (String preset : List.of("overworld", "large_biomes", "amplified")) {
                String name = "/vanilla/" + version + (preset.equals("overworld") ? "" : "-" + preset) + ".json";
                JsonObject route = JsonParser.parseString(resource(name)).getAsJsonObject();
                route.addProperty("sea_level", (int) config.seaLevel());
                applyRouter(route.getAsJsonObject("noise_router"), height, density, config);
                if (config.surface().equals("terrain-studio")) route.add("surface_rule", surfaceRule(version));
                files.put(MINECRAFT_SETTINGS + preset + ".json", GSON.toJson(route) + "\n");
            }
        } else {
            String[] parts = splitDimensionId(config.dimensionId());
            String namespace = parts[0], path = parts[1];
            String base = "src/main/resources/data/" + namespace + "/worldgen";
            JsonObject route = JsonParser.parseString(resource("/vanilla/" + version + ".json")).getAsJsonObject();
            route.addProperty("sea_level", (int) config.seaLevel());
            applyRouter(route.getAsJsonObject("noise_router"), height, density, config);
            if (config.surface().equals("terrain-studio")) route.add("surface_rule", surfaceRule(version));
            files.put(base + "/noise_settings/" + path + ".json", GSON.toJson(route) + "\n");
            files.put("src/main/resources/data/" + namespace + "/dimension_type/" + path + ".json",
                    GSON.toJson(dimensionType(config, config.mode().equals("preset"), version)) + "\n");
            files.put("src/main/resources/data/" + namespace + "/dimension/" + path + ".json",
                    GSON.toJson(dimension(config)) + "\n");
            if (config.mode().equals("preset")) {
                files.put(base + "/world_preset/" + path + ".json", GSON.toJson(worldPreset(config)) + "\n");
                warnings.add("World presets are data-driven; the entry has not been verified in a running client in this build.");
            }
        }
        return new Output(source, files, warnings, config.mode(), config.projectId(), GENERATOR_VERSION, config.generator());
    }

    private static Package readPackage(JsonObject root, String fallbackGenerator) {
        String format = str(root, "format");
        if (format.equals("terrain-studio")) {
            if (number(root, "version") != 1) throw new IllegalArgumentException("Unsupported Terrain Studio project format.");
            JsonObject world = obj(root, "world");
            double min = number(world, "minY"), max = number(world, "maxY"), sea = number(world, "seaLevel");
            int seed = whole(world, "seed", 0);
            return new Package(false, fallbackGenerator, "overworld", "legacy", "terrainstudio:highlands", "Highlands",
                    "vanilla", "minecraft:plains", "none", "vanilla", "balanced", min, max, sea, seed,
                    (int) (max - min + 1), 1, 0, true, false);
        }
        if (!format.equals("terrain-studio-minecraft"))
            throw new IllegalArgumentException("Unsupported file. Choose a .terrain project or a .tsmc integration package.");
        if (number(root, "version") != 1) throw new IllegalArgumentException("Unsupported integration package version.");
        JsonObject target = obj(root, "target");
        String generator = str(target, "generator");
        String mode = str(root, "mode");
        if (!mode.equals("overworld") && !mode.equals("dimension") && !mode.equals("preset"))
            throw new IllegalArgumentException("Unsupported integration mode: " + mode);
        JsonObject project = obj(root, "project");
        JsonObject dimension = obj(root, "dimension");
        JsonObject world = obj(root, "world");
        String projectId = optionalStr(project, "id", "package");
        double min = number(world, "minY"), max = number(world, "maxY");
        int height = (int) (max - min + 1);
        return new Package(true, generator, mode, projectId,
                str(dimension, "id"), str(dimension, "name"),
                optionalStr(dimension, "biomeSource", "vanilla"), optionalStr(dimension, "biome", "minecraft:plains"),
                optionalStr(root, "caves", "none"), optionalStr(root, "surface", "vanilla"),
                optionalStr(root, "performance", "balanced"),
                min, max, number(world, "seaLevel"), whole(world, "seed", 0),
                whole(world, "logicalHeight", height), number(world, "coordinateScale", 1),
                number(world, "ambientLight", 0), flag(world, "hasSkylight", true), flag(world, "hasCeiling", false));
    }

    private static boolean flag(JsonObject object, String key, boolean fallback) {
        if (!object.has(key) || object.get(key).isJsonNull()) return fallback;
        if (!object.get(key).isJsonPrimitive() || !object.get(key).getAsJsonPrimitive().isBoolean())
            throw new IllegalArgumentException("Invalid flag: " + key);
        return object.get(key).getAsBoolean();
    }

    private static void validateWorld(Package config) {
        if (config.maxY() <= config.minY()) throw new IllegalArgumentException("Maximum height must exceed minimum height.");
        if (config.seaLevel() != Math.rint(config.seaLevel()) || config.seaLevel() < config.minY() || config.seaLevel() > config.maxY())
            throw new IllegalArgumentException("Sea level must be a whole block height inside the build range.");
        if (config.mode().equals("overworld")) {
            if (config.minY() != -64 || config.maxY() != 319)
                throw new IllegalArgumentException("Overworld replacement requires minY -64 and maxY 319. Choose Custom dimension or World preset for other heights.");
        } else {
            String[] parts = splitDimensionId(config.dimensionId());
            if (parts[0].isBlank() || parts[1].isBlank()) throw new IllegalArgumentException("Invalid dimension ID.");
            int height = (int) (config.maxY() - config.minY() + 1);
            int minY = (int) config.minY();
            if (config.minY() != Math.rint(config.minY()) || config.maxY() != Math.rint(config.maxY())
                    || minY % 16 != 0 || height % 16 != 0)
                throw new IllegalArgumentException("Custom dimensions need whole-block bounds, a minimum Y that is a multiple of 16, and a height that is a multiple of 16.");
            if (config.minY() < -2032 || config.maxY() > 2031 || height > 4064)
                throw new IllegalArgumentException("Custom dimensions support Y between -2032 and 2031 with a height up to 4064.");
            if (config.logicalHeight() < 1 || config.logicalHeight() > height)
                throw new IllegalArgumentException("Logical height must be between 1 and " + height + ".");
            if (config.coordinateScale() < 0.00001 || config.coordinateScale() > 30000000)
                throw new IllegalArgumentException("Coordinate scale must be between 0.00001 and 30000000.");
            if (config.ambientLight() < 0 || config.ambientLight() > 1)
                throw new IllegalArgumentException("Ambient light must be between 0 and 1.");
        }
    }

    private static String[] splitDimensionId(String id) {
        if (!id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))
            throw new IllegalArgumentException("Dimension ID must look like terrainstudio:highlands (lowercase namespace:path).");
        int colon = id.indexOf(':');
        return new String[] { id.substring(0, colon), id.substring(colon + 1) };
    }

    private static String outputType(String kind) {
        return switch (kind) {
            case "coordinates", "warp", "swirl" -> "coordinate";
            case "output" -> null;
            default -> "scalar";
        };
    }
    private static String expectedType(String kind) {
        return switch (kind) {
            case "noise", "warp", "swirl", "radial" -> "coordinate";
            case "coordinates" -> null;
            default -> "scalar";
        };
    }

    private static void validateNode(GraphNode node) {
        JsonObject data = node.data();
        switch (node.kind()) {
            case "noise" -> {
                String noise = str(data, "noiseType");
                if (!NOISE_TYPES.contains(noise))
                    throw new IllegalArgumentException("Noise type " + noise + " cannot be exported. Supported: " + String.join(", ", NOISE_TYPES) + ".");
                if (number(data, "scale") <= 0) throw new IllegalArgumentException("Noise scale must be positive.");
                number(data, "amplitude");
                whole(data, "seed", 0);
                number(data, "rotation", 0);
            }
            case "multiply" -> number(data, "factor");
            case "clamp" -> {
                double min = number(data, "min", -1), max = number(data, "max", 1);
                if (min > max) throw new IllegalArgumentException("Clamp minimum must not exceed its maximum.");
            }
            case "remap" -> {
                double inMin = number(data, "inMin", 0), inMax = number(data, "inMax", 1);
                if (inMax <= inMin) throw new IllegalArgumentException("Remap input maximum must exceed its minimum.");
                number(data, "outMin", 0); number(data, "outMax", 1);
            }
            case "curve" -> {
                if (number(data, "gamma", 1) <= 0) throw new IllegalArgumentException("Curve gamma must be positive.");
            }
            case "blend" -> number(data, "factor", 0.5);
            case "terrace" -> {
                int steps = whole(data, "steps", 4);
                if (steps < 1 || steps > 64) throw new IllegalArgumentException("Terrace steps must be between 1 and 64.");
                number(data, "strength", 0.8);
            }
            case "warp", "erosion" -> {
                if (number(data, "scale") <= 0) throw new IllegalArgumentException("Scale must be positive.");
                if (number(data, "strength", 0) < 0) throw new IllegalArgumentException("Strength must not be negative.");
                whole(data, "seed", 0);
                number(data, "rotation", 0);
            }
            case "smoothstep" -> {
                double inMin = number(data, "inMin", 0), inMax = number(data, "inMax", 1);
                if (inMax <= inMin) throw new IllegalArgumentException("Smoothstep edge 1 must exceed edge 0.");
            }
            case "quantize" -> {
                int steps = whole(data, "steps", 8);
                if (steps < 1 || steps > 1024) throw new IllegalArgumentException("Quantize steps must be between 1 and 1024.");
            }
            case "power" -> {
                if (number(data, "exponent", 2) <= 0) throw new IllegalArgumentException("Exponent must be positive.");
            }
            case "threshold" -> {
                number(data, "threshold", 0.5);
                if (number(data, "strength", 0.02) < 0) throw new IllegalArgumentException("Threshold width must not be negative.");
            }
            case "offset" -> { number(data, "factor", 1); number(data, "bias", 0); }
            case "contrast" -> number(data, "contrast", 1.5);
            case "sine", "triangle" -> { number(data, "scale", 1); whole(data, "seed", 0); }
            case "radial" -> { if (number(data, "scale", 0.01) <= 0) throw new IllegalArgumentException("Radial scale must be positive."); }
            case "swirl" -> {
                number(data, "strength", 180);
                if (number(data, "scale", 0.01) <= 0) throw new IllegalArgumentException("Swirl scale must be positive.");
            }
            default -> {}
        }
    }

    private record CompiledGraph(String statements, String output) {}

    private static CompiledGraph emitGraph(List<String> order, Map<String, GraphNode> byId,
                                           Map<String, List<String>> incoming, List<String> outputInputs, int worldSeed) {
        StringBuilder statements = new StringBuilder();
        Map<String, Coord> coords = new HashMap<>();
        Map<String, String> scalars = new HashMap<>();
        int coordCounter = 0, scalarCounter = 0, tempCounter = 0;
        for (String id : order) {
            GraphNode node = byId.get(id);
            String kind = node.kind();
            JsonObject data = node.data();
            List<String> in = incoming.getOrDefault(id, List.of());
            if (kind.equals("coordinates")) {
                String var = "p" + coordCounter++;
                statements.append("        double ").append(var).append("X = x;\n");
                statements.append("        double ").append(var).append("Z = z;\n");
                coords.put(id, new Coord(var + "X", var + "Z"));
                continue;
            }
            if (kind.equals("warp")) {
                if (in.size() != 1) throw new IllegalArgumentException("Domain Warp requires exactly one coordinate input.");
                Coord parent = coords.get(in.get(0));
                if (parent == null) throw new IllegalArgumentException("Domain Warp needs a Coordinates or warped coordinate input.");
                String var = "p" + coordCounter++;
                double scale = number(data, "scale"), strength = number(data, "strength", 0);
                int seed = whole(data, "seed", 0) + worldSeed;
                String rx = rotatedX(parent, number(data, "rotation", 0));
                String rz = rotatedZ(parent, number(data, "rotation", 0));
                statements.append("        double ").append(var).append("X = ").append(parent.x())
                        .append(" + (fractal(").append(rx).append(" * ").append(decimal(scale)).append(", ")
                        .append(rz).append(" * ").append(decimal(scale)).append(", ").append(seed)
                        .append(", false) * 2 - 1) * ").append(decimal(strength)).append(";\n");
                statements.append("        double ").append(var).append("Z = ").append(parent.z())
                        .append(" + (fractal(").append(rx).append(" * ").append(decimal(scale)).append(", ")
                        .append(rz).append(" * ").append(decimal(scale)).append(", ").append(seed + 41)
                        .append(", false) * 2 - 1) * ").append(decimal(strength)).append(";\n");
                coords.put(id, new Coord(var + "X", var + "Z"));
                continue;
            }
            if (kind.equals("noise")) {
                if (in.size() != 1) throw new IllegalArgumentException("Noise requires exactly one coordinate input.");
                Coord parent = coords.get(in.get(0));
                if (parent == null) throw new IllegalArgumentException("Noise needs a Coordinates or Domain Warp input.");
                double scale = number(data, "scale"), amplitude = number(data, "amplitude");
                int seed = whole(data, "seed", 0) + worldSeed;
                String var = "v" + scalarCounter++;
                String rx = rotatedX(parent, number(data, "rotation", 0));
                String rz = rotatedZ(parent, number(data, "rotation", 0));
                String argX = "((" + rx + ") * " + decimal(scale) + ")";
                String argZ = "((" + rz + ") * " + decimal(scale) + ")";
                String call = switch (str(data, "noiseType")) {
                    case "ridged" -> "fractal(" + argX + ", " + argZ + ", " + seed + ", true)";
                    case "perlin" -> "gradientFractal(" + argX + ", " + argZ + ", " + seed + ", false)";
                    case "simplex" -> "gradientFractal(" + argX + ", " + argZ + ", " + seed + ", true)";
                    case "cellular" -> "cellular(" + argX + ", " + argZ + ", " + seed + ")";
                    case "wave" -> "wave(" + argX + ", " + argZ + ", " + seed + ")";
                    case "minecraft-erosion" -> "fractal((" + argX + " * 1.7), (" + argZ + " * 1.7), " + (seed + 203) + ", false)";
                    case "minecraft-weirdness" -> "fractal((" + argX + " * 1.3), (" + argZ + " * 1.3), " + (seed + 19) + ", true)";
                    case "minecraft-temperature" -> "fractal((" + argX + " * 0.8), (" + argZ + " * 0.8), " + (seed + 307) + ", false)";
                    default -> "fractal(" + argX + ", " + argZ + ", " + seed + ", false)";
                };
                statements.append("        double ").append(var).append(" = ").append(call)
                        .append(" * ").append(decimal(amplitude)).append(";\n");
                scalars.put(id, var);
                continue;
            }
            if (kind.equals("swirl")) {
                if (in.size() != 1) throw new IllegalArgumentException("Swirl requires exactly one coordinate input.");
                Coord parent = coords.get(in.get(0));
                if (parent == null) throw new IllegalArgumentException("Swirl needs a Coordinates or warped coordinate input.");
                String var = "p" + coordCounter++;
                String angle = "swirl" + tempCounter++;
                statements.append("        double ").append(angle).append(" = ")
                        .append(decimal(number(data, "strength", 180))).append(" * 0.017453292519943295 * Math.sqrt(")
                        .append(parent.x()).append(" * ").append(parent.x()).append(" + ")
                        .append(parent.z()).append(" * ").append(parent.z()).append(") * ")
                        .append(decimal(number(data, "scale", 0.01))).append(";\n");
                statements.append("        double ").append(var).append("X = ").append(parent.x())
                        .append(" * Math.cos(").append(angle).append(") - ").append(parent.z())
                        .append(" * Math.sin(").append(angle).append(");\n");
                statements.append("        double ").append(var).append("Z = ").append(parent.x())
                        .append(" * Math.sin(").append(angle).append(") + ").append(parent.z())
                        .append(" * Math.cos(").append(angle).append(");\n");
                coords.put(id, new Coord(var + "X", var + "Z"));
                continue;
            }
            if (kind.equals("radial")) {
                if (in.size() != 1) throw new IllegalArgumentException("Radial Distance requires exactly one coordinate input.");
                Coord parent = coords.get(in.get(0));
                if (parent == null) throw new IllegalArgumentException("Radial Distance needs a Coordinates or warped coordinate input.");
                String var = "v" + scalarCounter++;
                statements.append("        double ").append(var).append(" = Math.sqrt(").append(parent.x()).append(" * ").append(parent.x())
                        .append(" + ").append(parent.z()).append(" * ").append(parent.z()).append(") * ")
                        .append(decimal(number(data, "scale", 0.01))).append(";\n");
                scalars.put(id, var);
                continue;
            }
            if (kind.equals("output")) {
                if (in.size() != 1) throw new IllegalArgumentException("Terrain Output requires exactly one input.");
                String source = scalars.get(in.get(0));
                if (source == null) throw new IllegalArgumentException("Terrain Output needs a scalar input.");
                continue;
            }
            if (EXACTLY_TWO.contains(kind) && in.size() != 2) throw new IllegalArgumentException(kind + " requires exactly two inputs.");
            if (AT_LEAST_ONE.contains(kind) && in.isEmpty()) throw new IllegalArgumentException(kind + " requires at least one input.");
            if (!AT_LEAST_ONE.contains(kind) && !EXACTLY_TWO.contains(kind) && in.size() != 1)
                throw new IllegalArgumentException(kind + " requires exactly one input.");
            List<String> inputs = new ArrayList<>();
            for (String source : in) {
                String value = scalars.get(source);
                if (value == null) throw new IllegalArgumentException(kind + " needs scalar inputs.");
                inputs.add(value);
            }
            String var = "v" + scalarCounter++;
            String expression;
            switch (kind) {
                case "add" -> expression = "(" + String.join(" + ", inputs) + ")";
                case "multiply" -> expression = "(" + decimal(number(data, "factor", 1)) + " * " + String.join(" * ", inputs) + ")";
                case "clamp" -> expression = "Math.max(" + decimal(number(data, "min", -1)) + ", Math.min(" + decimal(number(data, "max", 1)) + ", " + inputs.get(0) + "))";
                case "remap" -> expression = "(" + decimal(number(data, "outMin", 0)) + " + " + clamp01("(" + inputs.get(0) + " - "
                        + decimal(number(data, "inMin", 0)) + ") / (" + decimal(number(data, "inMax", 1)) + " - "
                        + decimal(number(data, "inMin", 0)) + ")") + " * (" + decimal(number(data, "outMax", 1)) + " - "
                        + decimal(number(data, "outMin", 0)) + "))";
                case "curve" -> expression = "Math.pow(" + clamp01(inputs.get(0)) + ", " + decimal(number(data, "gamma", 1)) + ")";
                case "blend" -> {
                    double factor = Math.max(0, Math.min(1, number(data, "factor", 0.5)));
                    expression = "(" + inputs.get(0) + " + (" + inputs.get(1) + " - " + inputs.get(0) + ") * " + decimal(factor) + ")";
                }
                case "terrace" -> {
                    int steps = whole(data, "steps", 4);
                    double strength = Math.max(0, Math.min(1, number(data, "strength", 0.8)));
                    String original = inputs.get(0);
                    String stepped = "(Math.floor(" + clamp01(original) + " * " + steps + ") / " + steps + ")";
                    expression = "(" + original + " + (" + stepped + " - " + original + ") * " + decimal(strength) + ")";
                }
                case "erosion" -> expression = "erode(" + inputs.get(0) + ", x, z, " + decimal(number(data, "scale"))
                        + ", " + decimal(number(data, "strength", 0)) + ", " + (whole(data, "seed", 0) + worldSeed) + ")";
                case "min", "max" -> {
                    String fold = inputs.get(0), function = kind.equals("min") ? "Math.min" : "Math.max";
                    for (int i = 1; i < inputs.size(); i++) fold = function + "(" + fold + ", " + inputs.get(i) + ")";
                    expression = fold;
                }
                case "subtract" -> expression = "(" + inputs.get(0) + " - " + inputs.get(1) + ")";
                case "divide" -> expression = "(" + inputs.get(1) + " == 0 ? 0.0 : "
                        + inputs.get(0) + " / " + inputs.get(1) + ")";
                case "power" -> expression = "(" + inputs.get(0) + " < 0 ? -Math.pow(-(" + inputs.get(0) + "), "
                        + decimal(number(data, "exponent", 2)) + ") : Math.pow(" + inputs.get(0) + ", "
                        + decimal(number(data, "exponent", 2)) + "))";
                case "abs" -> expression = "Math.abs(" + inputs.get(0) + ")";
                case "invert" -> expression = "(1 - " + inputs.get(0) + ")";
                case "smoothstep" -> expression = "smoothstep(" + inputs.get(0) + ", "
                        + decimal(number(data, "inMin", 0)) + ", " + decimal(number(data, "inMax", 1)) + ")";
                case "threshold" -> expression = "threshold(" + inputs.get(0) + ", "
                        + decimal(number(data, "threshold", 0.5)) + ", " + decimal(number(data, "strength", 0.02)) + ")";
                case "offset" -> expression = "(" + inputs.get(0) + " * " + decimal(number(data, "factor", 1))
                        + " + " + decimal(number(data, "bias", 0)) + ")";
                case "ridge" -> expression = "(1 - Math.abs(" + inputs.get(0) + " * 2 - 1))";
                case "sine" -> expression = "sine(" + inputs.get(0) + ", " + decimal(number(data, "scale", 1))
                        + ", " + (whole(data, "seed", 0) + worldSeed) + ")";
                case "triangle" -> expression = "triangle(" + inputs.get(0) + ", " + decimal(number(data, "scale", 1))
                        + ", " + (whole(data, "seed", 0) + worldSeed) + ")";
                case "quantize" -> {
                    int count = whole(data, "steps", 8);
                    expression = "(Math.floor(" + clamp01(inputs.get(0)) + " * " + count + " + 0.5) / " + count + ")";
                }
                case "contrast" -> expression = "((" + inputs.get(0) + " - 0.5) * "
                        + decimal(number(data, "contrast", 1.5)) + " + 0.5)";
                default -> throw new IllegalArgumentException("Unsupported node kind in output graph: " + kind);
            }
            statements.append("        double ").append(var).append(" = ").append(expression).append(";\n");
            scalars.put(id, var);
            tempCounter++;
        }
        String output = scalars.get(outputInputs.get(0));
        if (output == null) throw new IllegalArgumentException("Terrain Output is not connected to a scalar signal.");
        return new CompiledGraph(statements.toString(), output);
    }

    private static String rotatedX(Coord source, double rotation) {
        if (rotation == 0) return source.x();
        return "(" + source.x() + " * Math.cos(" + decimal(rotation) + " * Math.PI / 180.0) - "
                + source.z() + " * Math.sin(" + decimal(rotation) + " * Math.PI / 180.0))";
    }
    private static String rotatedZ(Coord source, double rotation) {
        if (rotation == 0) return source.z();
        return "(" + source.x() + " * Math.sin(" + decimal(rotation) + " * Math.PI / 180.0) + "
                + source.z() + " * Math.cos(" + decimal(rotation) + " * Math.PI / 180.0))";
    }

    private static void applyRouter(JsonObject router, JsonObject height, JsonObject density, Package config) {
        if (config.caves().equals("vanilla-approximate")) {
            // Keep vanilla final_density (and its caves) and only redirect the density it wraps.
            router.add("sloped_cheese", density.deepCopy());
            return;
        }
        router.add("final_density", density.deepCopy());
        if (router.has("initial_density_without_jaggedness")) router.add("initial_density_without_jaggedness", density.deepCopy());
        if (router.has("preliminary_surface_level")) router.add("preliminary_surface_level", height.deepCopy());
        if (router.has("chunk_surface_level")) router.add("chunk_surface_level", height.deepCopy());
    }

    private static JsonObject blockRule(String block) {
        JsonObject state = new JsonObject();
        state.addProperty("Name", block);
        JsonObject rule = new JsonObject();
        rule.addProperty("type", "minecraft:block");
        rule.add("result_state", state);
        return rule;
    }
    private static JsonObject condition(JsonObject condition, JsonObject then, boolean modern) {
        JsonObject rule = new JsonObject();
        rule.addProperty("type", "minecraft:condition");
        rule.add("if_true", condition);
        // 26.1.2 renamed the condition result field; 1.21.1 still uses `then`.
        rule.add(modern ? "then_run" : "then", then);
        return rule;
    }
    private static JsonObject surfaceRule(String version) {
        boolean modern = version.equals("26.1.2");
        JsonObject water = new JsonObject();
        water.addProperty("type", "minecraft:water");
        water.addProperty("offset", 0);
        water.addProperty("surface_depth_multiplier", 0);
        water.addProperty("add_stone_depth", false);
        JsonObject top = new JsonObject();
        top.addProperty("type", "minecraft:stone_depth");
        top.addProperty("offset", 0);
        top.addProperty("surface_type", "floor");
        top.addProperty("add_surface_depth", false);
        top.addProperty("secondary_depth_range", 0);
        JsonObject filler = new JsonObject();
        filler.addProperty("type", "minecraft:stone_depth");
        filler.addProperty("offset", 3);
        filler.addProperty("surface_type", "floor");
        filler.addProperty("add_surface_depth", true);
        filler.addProperty("secondary_depth_range", 0);
        JsonArray sequence = new JsonArray();
        // Only the surface layer chooses grass/sand; deeper layers must stay dirt then stone.
        JsonObject topChoice = new JsonObject();
        topChoice.addProperty("type", "minecraft:sequence");
        JsonArray topSequence = new JsonArray();
        topSequence.add(condition(water, blockRule("minecraft:grass_block"), modern));
        topSequence.add(blockRule("minecraft:sand"));
        topChoice.add("sequence", topSequence);
        sequence.add(condition(top, topChoice, modern));
        sequence.add(condition(filler, blockRule("minecraft:dirt"), modern));
        sequence.add(blockRule("minecraft:stone"));
        JsonObject root = new JsonObject();
        root.addProperty("type", "minecraft:sequence");
        root.add("sequence", sequence);
        return root;
    }

    private static JsonObject dimensionType(Package config, boolean preset, String version) {
        JsonObject type = new JsonObject();
        boolean modern = version.equals("26.1.2");
        type.addProperty("has_skylight", true);
        type.addProperty("has_ceiling", false);
        type.addProperty("coordinate_scale", 1.0);
        type.addProperty("ambient_light", 0.0);
        int height = (int) (config.maxY() - config.minY() + 1);
        type.addProperty("logical_height", config.logicalHeight());
        type.addProperty("height", height);
        type.addProperty("min_y", (int) config.minY());
        type.addProperty("coordinate_scale", config.coordinateScale());
        type.addProperty("ambient_light", config.ambientLight());
        type.addProperty("has_skylight", config.hasSkylight());
        type.addProperty("has_ceiling", config.hasCeiling());
        type.addProperty("infiniburn", "#minecraft:infiniburn_overworld");
        type.addProperty("monster_spawn_block_light_limit", 0);
        JsonObject uniform = new JsonObject();
        uniform.addProperty("type", "minecraft:uniform");
        if (modern) {
            // 26.1.2 flattened the spawn-light provider and added dragon-fight/clock fields.
            uniform.addProperty("min_inclusive", 0);
            uniform.addProperty("max_inclusive", 7);
            type.addProperty("has_ender_dragon_fight", false);
            type.addProperty("default_clock", "minecraft:overworld");
            type.addProperty("timelines", "#minecraft:in_overworld");
        } else {
            type.addProperty("ultrawarm", false);
            type.addProperty("natural", true);
            type.addProperty("piglin_safe", false);
            type.addProperty("respawn_anchor_works", false);
            type.addProperty("bed_works", true);
            type.addProperty("has_raids", preset);
            type.addProperty("effects", "minecraft:overworld");
            JsonObject value = new JsonObject();
            value.addProperty("min_inclusive", 0);
            value.addProperty("max_inclusive", 7);
            uniform.add("value", value);
        }
        type.add("monster_spawn_light_level", uniform);
        return type;
    }

    private static JsonObject biomeSource(Package config) {
        JsonObject source = new JsonObject();
        if (config.biomeSource().equals("fixed")) {
            source.addProperty("type", "minecraft:fixed");
            source.addProperty("biome", config.biome());
        } else {
            source.addProperty("type", "minecraft:multi_noise");
            source.addProperty("preset", "minecraft:overworld");
        }
        return source;
    }

    private static JsonObject generator(Package config) {
        JsonObject generator = new JsonObject();
        generator.addProperty("type", "minecraft:noise");
        generator.add("biome_source", biomeSource(config));
        generator.addProperty("settings", config.dimensionId());
        return generator;
    }

    private static JsonObject dimension(Package config) {
        JsonObject dimension = new JsonObject();
        dimension.addProperty("type", config.dimensionId());
        dimension.add("generator", generator(config));
        return dimension;
    }

    private static JsonObject worldPreset(Package config) {
        JsonObject dimensions = new JsonObject();
        dimensions.add("minecraft:overworld", dimension(config));
        // Keep the Nether and End available so the preset is a complete, playable world.
        JsonObject netherGenerator = new JsonObject();
        netherGenerator.addProperty("type", "minecraft:noise");
        JsonObject netherBiomes = new JsonObject();
        netherBiomes.addProperty("type", "minecraft:multi_noise");
        netherBiomes.addProperty("preset", "minecraft:nether");
        netherGenerator.add("biome_source", netherBiomes);
        netherGenerator.addProperty("settings", "minecraft:nether");
        JsonObject nether = new JsonObject();
        nether.addProperty("type", "minecraft:the_nether");
        nether.add("generator", netherGenerator);
        dimensions.add("minecraft:the_nether", nether);
        JsonObject endGenerator = new JsonObject();
        endGenerator.addProperty("type", "minecraft:noise");
        JsonObject endBiomes = new JsonObject();
        endBiomes.addProperty("type", "minecraft:the_end");
        endGenerator.add("biome_source", endBiomes);
        endGenerator.addProperty("settings", "minecraft:end");
        JsonObject end = new JsonObject();
        end.addProperty("type", "minecraft:the_end");
        end.add("generator", endGenerator);
        dimensions.add("minecraft:the_end", end);
        JsonObject preset = new JsonObject();
        preset.add("dimensions", dimensions);
        return preset;
    }

    private static void visit(String id, Map<String, List<String>> incoming, Set<String> active, Set<String> done, List<String> order) {
        if (done.contains(id)) return;
        if (!active.add(id)) throw new IllegalArgumentException("Graph contains a cycle.");
        for (String parent : incoming.getOrDefault(id, List.of())) visit(parent, incoming, active, done, order);
        active.remove(id); done.add(id); order.add(id);
    }
}
