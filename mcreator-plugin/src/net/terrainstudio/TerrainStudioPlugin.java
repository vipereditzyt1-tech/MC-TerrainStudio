package net.terrainstudio;

import net.mcreator.plugin.JavaPlugin;
import net.mcreator.plugin.Plugin;
import net.mcreator.plugin.events.workspace.MCreatorLoadedEvent;
import net.mcreator.ui.MCreator;
import net.mcreator.workspace.Workspace;
import javax.swing.*;
import javax.swing.filechooser.FileNameExtensionFilter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

public class TerrainStudioPlugin extends JavaPlugin {
    private static final AtomicBoolean HANDOFF_STARTED = new AtomicBoolean();
    /** The window a package pushed from Terrain Studio is imported into; the newest window wins. */
    private static volatile MCreator activeWindow;

    public TerrainStudioPlugin(Plugin plugin) {
        super(plugin);
        startHandoff();
        addListener(MCreatorLoadedEvent.class, event -> SwingUtilities.invokeLater(() -> addMenu(event.getMCreator())));
    }

    /**
     * Picks up packages Terrain Studio queues in its hand-off folder. Started once per JVM: MCreator
     * creates a plugin instance per window, and two watchers would offer every import twice.
     */
    private static void startHandoff() {
        if (!HANDOFF_STARTED.compareAndSet(false, true)) return;
        HandoffWatcher.start(HandoffWatcher.directory(), packageFile -> SwingUtilities.invokeLater(() -> {
            MCreator target = activeWindow;
            if (target == null) return;
            importFrom(target, packageFile);
        }));
    }

    private static void addMenu(MCreator mcreator) {
        // MCreatorLoadedEvent can fire again for the same window (workspace reload); never stack menus.
        for (int index = 0; index < mcreator.getMainMenuBar().getMenuCount(); index++) {
            if ("Terrain Studio".equals(mcreator.getMainMenuBar().getMenu(index).getText())) return;
        }
        activeWindow = mcreator;
        JMenu menu = new JMenu("Terrain Studio");
        menu.setName("terrain-studio-menu");

        JMenuItem importItem = new JMenuItem("Import Terrain Studio package…");
        importItem.addActionListener(event -> importTerrain(mcreator));
        menu.add(importItem);

        JMenuItem validateItem = new JMenuItem("Validate Terrain Studio package…");
        validateItem.addActionListener(event -> validatePackage(mcreator));
        menu.add(validateItem);

        menu.addSeparator();

        JMenuItem rollbackItem = new JMenuItem("Roll back last Terrain Studio import");
        rollbackItem.addActionListener(event -> rollback(mcreator));
        menu.add(rollbackItem);

        menu.addSeparator();

        JMenuItem launchItem = new JMenuItem("Launch Terrain Studio");
        launchItem.setToolTipText("Start the Terrain Studio editor, which can push packages straight into this workspace.");
        launchItem.addActionListener(event -> launchTerrainStudio(mcreator));
        menu.add(launchItem);

        mcreator.getMainMenuBar().add(menu);
        mcreator.getMainMenuBar().revalidate();
    }

    private static String workspaceGenerator(MCreator mcreator, Workspace workspace) {
        String generator = workspace.getWorkspaceSettings().getCurrentGenerator();
        if (!generator.equals("neoforge-1.21.1") && !generator.equals("neoforge-26.1.2")) {
            JOptionPane.showMessageDialog(mcreator, "This plugin supports NeoForge 1.21.1 and 26.1.2 workspaces only.",
                    "Unsupported workspace", JOptionPane.WARNING_MESSAGE);
            return null;
        }
        if (workspace.getMCreatorVersion() <= 202500220614L) {
            JOptionPane.showMessageDialog(mcreator, "Upgrade and regenerate this workspace in MCreator before importing: legacy regeneration can remove custom files.",
                    "Workspace upgrade required", JOptionPane.WARNING_MESSAGE);
            return null;
        }
        return generator;
    }

    private static String chooseFile(MCreator mcreator, String title) {
        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle(title);
        chooser.setFileFilter(new FileNameExtensionFilter("Terrain Studio files (*.tsmc, *.terrain)", "tsmc", "terrain"));
        chooser.addChoosableFileFilter(new FileNameExtensionFilter("Terrain Studio integration package (*.tsmc)", "tsmc"));
        chooser.addChoosableFileFilter(new FileNameExtensionFilter("Terrain Studio project (*.terrain)", "terrain"));
        if (chooser.showOpenDialog(mcreator) != JFileChooser.APPROVE_OPTION) return null;
        return chooser.getSelectedFile().getAbsolutePath();
    }

    private static String describe(String mode, String dimensionId) {
        return switch (mode) {
            case "dimension" -> "Mode: Custom dimension (" + dimensionId + ").\nAfter building, enter it with /execute in "
                    + dimensionId + " run tp @s 0 100 0.";
            case "preset" -> "Mode: World preset. Create a NEW world and choose the Terrain Studio world preset.\n" +
                    "The world type entry has not been verified in a running client in this build.";
            default -> "Mode: Overworld replacement. Use a NEW world with the Default, Large Biomes or Amplified world type.\n" +
                    "Existing chunks are not regenerated, and other world types keep vanilla terrain.";
        };
    }

    private static void importTerrain(MCreator mcreator) {
        String chosen = chooseFile(mcreator, "Import Terrain Studio package");
        if (chosen == null) return;
        importFrom(mcreator, Path.of(chosen));
    }

    /** Validates, confirms and installs one package; shared by the file chooser and the hand-off folder. */
    private static void importFrom(MCreator mcreator, Path file) {
        Workspace workspace = mcreator.getWorkspace();
        String generator = workspaceGenerator(mcreator, workspace);
        if (generator == null) return;
        try {
            if (!Files.isRegularFile(file) || Files.size(file) > 20 * 1024 * 1024)
                throw new IllegalArgumentException("Package must be a file smaller than 20 MB.");
            String text = Files.readString(file, StandardCharsets.UTF_8);
            TerrainCompiler.Output output = TerrainCompiler.compile(text, workspace.getWorkspaceSettings().getModID(), generator);
            if (!output.generator().equals(generator))
                throw new IllegalArgumentException("This package targets " + output.generator() + ", but the workspace uses " + generator + ". Export a package for the workspace target.");
            StringBuilder detail = new StringBuilder(describe(output.mode(), output.mode().equals("overworld") ? "minecraft:overworld" : "the exported dimension"));
            detail.append("\n\n").append(output.files().size()).append(" generated files will be written; files that already exist are protected and backed up first.");
            if (!output.warnings().isEmpty()) {
                detail.append("\n\nWarnings:");
                for (String warning : output.warnings()) detail.append("\n• ").append(warning);
            }
            int confirmed = JOptionPane.showConfirmDialog(mcreator, detail.toString(), "Import terrain",
                    JOptionPane.OK_CANCEL_OPTION, JOptionPane.WARNING_MESSAGE);
            if (confirmed != JOptionPane.OK_OPTION) return;
            workspace.getWorkspaceFolder().toPath();
            WorkspaceInstaller.install(workspace.getWorkspaceFolder().toPath(), output);
            for (String relative : output.files().keySet()) {
                workspace.getGenerator().trackFile(workspace.getWorkspaceFolder().toPath().resolve(relative).toFile());
            }
            workspace.getGenerator().notifyDaemonsAboutChangedPaths();
            JOptionPane.showMessageDialog(mcreator,
                    "Terrain imported. Build the workspace, then create a NEW Minecraft world.\n" + describe(output.mode(), "the exported dimension")
                            + "\n\nHigher-priority datapacks or other worldgen mods may override this terrain.",
                    "Terrain imported", JOptionPane.INFORMATION_MESSAGE);
        } catch (Exception error) {
            JOptionPane.showMessageDialog(mcreator,
                    "Terrain import failed; existing conflicting files were not overwritten.\n" + error.getMessage(),
                    "Terrain Studio", JOptionPane.ERROR_MESSAGE);
        }
    }

    private static void validatePackage(MCreator mcreator) {
        Workspace workspace = mcreator.getWorkspace();
        String generator = workspaceGenerator(mcreator, workspace);
        if (generator == null) return;
        String chosen = chooseFile(mcreator, "Validate Terrain Studio package");
        if (chosen == null) return;
        try {
            Path file = Path.of(chosen);
            if (!Files.isRegularFile(file) || Files.size(file) > 20 * 1024 * 1024)
                throw new IllegalArgumentException("Package must be a file smaller than 20 MB.");
            TerrainCompiler.Output output = TerrainCompiler.compile(Files.readString(file, StandardCharsets.UTF_8),
                    workspace.getWorkspaceSettings().getModID(), generator);
            StringBuilder report = new StringBuilder();
            report.append("Target: ").append(output.generator()).append('\n');
            report.append("Mode: ").append(output.mode()).append('\n');
            report.append("Generated files: ").append(output.files().size()).append('\n');
            report.append("Compatibility: ").append(output.generator().equals(generator) ? "workspace matches" : "WORKSPACE MISMATCH").append('\n');
            if (output.warnings().isEmpty()) report.append("\nNo warnings.");
            else {
                report.append("\nWarnings:");
                for (String warning : output.warnings()) report.append("\n• ").append(warning);
            }
            report.append("\n\nNo files were written.");
            JOptionPane.showMessageDialog(mcreator, report.toString(), "Terrain Studio validation",
                    output.generator().equals(generator) ? JOptionPane.INFORMATION_MESSAGE : JOptionPane.WARNING_MESSAGE);
        } catch (Exception error) {
            JOptionPane.showMessageDialog(mcreator, "Validation failed.\n" + error.getMessage(),
                    "Terrain Studio", JOptionPane.ERROR_MESSAGE);
        }
    }

    private static void rollback(MCreator mcreator) {
        try {
            int restored = WorkspaceInstaller.rollback(mcreator.getWorkspace().getWorkspaceFolder().toPath());
            mcreator.getWorkspace().getGenerator().notifyDaemonsAboutChangedPaths();
            JOptionPane.showMessageDialog(mcreator, "Rolled back " + restored + " generated files. Regenerate the workspace in MCreator.",
                    "Terrain Studio", JOptionPane.INFORMATION_MESSAGE);
        } catch (Exception error) {
            JOptionPane.showMessageDialog(mcreator, "Rollback failed.\n" + error.getMessage(),
                    "Terrain Studio", JOptionPane.ERROR_MESSAGE);
        }
    }

    private static void launchTerrainStudio(MCreator mcreator) {
        Path executable = TerrainStudioLauncher.locate(System.getenv());
        if (executable == null) {
            JOptionPane.showMessageDialog(mcreator,
                    "Terrain Studio was not found. Install it with the Windows installer, or point TERRAIN_STUDIO_EXE at its executable.",
                    "Terrain Studio", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        try {
            TerrainStudioLauncher.launch(executable);
        } catch (IOException error) {
            JOptionPane.showMessageDialog(mcreator, "Could not start " + executable + "\n" + error.getMessage(),
                    "Terrain Studio", JOptionPane.ERROR_MESSAGE);
        }
    }
}
